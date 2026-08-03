// Household access + device identity.
//
// Everyone shares one Supabase account; the household passphrase is its password.
// "Who did this" comes from the device's chosen member name, recorded on every
// item_event — enough for a family activity feed without per-person logins.

import { HOUSEHOLD_EMAIL, isConfigured, REQUIRE_PASSPHRASE } from './config.js';
import * as sb from './supabase.js';
import * as idb from './idb.js';
import { emit, EVENTS } from './bus.js';
import { uuid } from './model.js';

//   open  — no sign-in; the publishable key alone talks to Supabase
//   cloud — signed in to the shared household account
//   local — this phone only, no server
const MODE_KEY = 'gi.mode';
const DEVICE_KEY = 'gi.device';    // { id, name }

export function mode() {
  return localStorage.getItem(MODE_KEY) || null;
}

/** Does this build sync to Supabase at all, whether or not it signs in? */
export function isSyncing() {
  const m = mode();
  return m === 'open' || (m === 'cloud' && sb.hasSession());
}

export function isUnlocked() {
  const m = mode();
  if (m === 'local' || m === 'open') return true;
  return m === 'cloud' && sb.hasSession();
}

export function device() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
    if (saved?.id) return saved;
  } catch { /* fall through */ }
  const fresh = { id: uuid(), name: 'Me' };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(fresh));
  return fresh;
}

export function setDeviceName(name) {
  const d = { ...device(), name: String(name || '').trim() || 'Me' };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
  emit(EVENTS.AUTH_CHANGED);
  return d;
}

/** Sign in to the shared household account and remember this device's member name. */
export async function unlockCloud(passphrase, name) {
  if (!isConfigured()) throw new Error('No Supabase project is configured yet.');

  // Sign in first: if this fails, nothing has changed and the gate stays put.
  await sb.signIn(HOUSEHOLD_EMAIL, passphrase);

  localStorage.setItem(MODE_KEY, 'cloud');
  setDeviceName(name);

  // Registering the member is a nicety for the history feed, not a gate. If it
  // fails, the sign-in still stands and the outbox will retry — failing the
  // whole unlock here would strand the user with a valid session they can't use.
  try {
    await ensureMember();
  } catch (err) {
    console.warn('[auth] could not register this device as a member', err);
  }

  emit(EVENTS.AUTH_CHANGED);
}

/**
 * Join the shared database with no sign-in. Only valid when the project has
 * supabase/open-access.sql installed — otherwise every request is refused by RLS.
 */
export async function unlockOpen(name) {
  if (!isConfigured()) throw new Error('No Supabase project is configured yet.');
  if (REQUIRE_PASSPHRASE) throw new Error('This build requires the household passphrase.');

  localStorage.setItem(MODE_KEY, 'open');
  setDeviceName(name);

  try {
    await ensureMember();
  } catch (err) {
    console.warn('[auth] could not register this device as a member', err);
  }

  emit(EVENTS.AUTH_CHANGED);
}

/** Run against IndexedDB only. Useful before Supabase exists, or as a fallback. */
export function unlockLocal(name) {
  localStorage.setItem(MODE_KEY, 'local');
  setDeviceName(name);
  emit(EVENTS.AUTH_CHANGED);
}

export function lock() {
  sb.clearSession();
  localStorage.removeItem(MODE_KEY);
  emit(EVENTS.AUTH_CHANGED);
}

/** Make sure this device's name exists as a member row so history can name it. */
async function ensureMember() {
  const d = device();
  const existing = await idb.get('members', d.id);
  if (existing && existing.display_name === d.name) return existing;

  const { memberRepo } = await import('../data/members.js');
  return memberRepo.upsertSelf(d);
}

export async function currentMemberId() {
  return device().id;
}
