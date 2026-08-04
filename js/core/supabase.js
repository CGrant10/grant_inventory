// Minimal Supabase client — auth (GoTrue) + database (PostgREST) + storage.
//
// Deliberately hand-rolled instead of vendoring supabase-js: the app needs about
// six endpoints, and this keeps the build step at zero and the bundle honest.

import { backend, isConfigured } from './config.js';

const SESSION_KEY = 'gi.session';

let session = loadSession();
let refreshing = null;

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function saveSession(next) {
  session = next;
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else localStorage.removeItem(SESSION_KEY);
}

export function hasSession() {
  return Boolean(session?.access_token);
}

export function clearSession() {
  saveSession(null);
}

function expired() {
  // Refresh a minute early so a long request can't straddle the expiry.
  return !session?.expires_at || Date.now() > (session.expires_at - 60_000);
}

function stamp(raw) {
  return {
    access_token:  raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at:    Date.now() + ((raw.expires_in ?? 3600) * 1000),
    user_id:       raw.user?.id ?? null,
  };
}

async function readError(res) {
  let body = '';
  try { body = await res.text(); } catch { /* ignore */ }
  try {
    const json = JSON.parse(body);
    return json.error_description || json.message || json.msg || json.error || body;
  } catch { return body || `HTTP ${res.status}`; }
}

/* ---- Auth ---- */

export async function signIn(email, password) {
  const { url, anonKey } = backend();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  saveSession(stamp(await res.json()));
  return session;
}

async function refresh() {
  if (!session?.refresh_token) throw new Error('No session to refresh');
  if (refreshing) return refreshing;

  const { url, anonKey } = backend();
  refreshing = (async () => {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) {
      clearSession();
      throw new Error(await readError(res));
    }
    saveSession(stamp(await res.json()));
    return session;
  })().finally(() => { refreshing = null; });

  return refreshing;
}

async function authHeaders() {
  const { anonKey } = backend();
  if (session && expired()) await refresh();
  return {
    apikey: anonKey,
    Authorization: `Bearer ${session?.access_token || anonKey}`,
  };
}

/* ---- Database ---- */

async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!isConfigured()) throw new Error('Backend not configured');
  const { url } = backend();

  const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(await readError(res));
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Rows changed since a cursor, oldest first. Tombstones come along — the caller
 * needs them to delete locally.
 */
export function selectSince(table, column, cursor, limit = 1000) {
  const params = new URLSearchParams({
    select: '*',
    order: `${column}.asc`,
    limit: String(limit),
  });
  if (cursor) params.append(column, `gt.${cursor}`);
  return rest(`${table}?${params}`);
}

export function upsert(table, rows) {
  return rest(table, {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

export function rpc(fn, args = {}) {
  return rest(`rpc/${fn}`, { method: 'POST', body: args });
}

/* ---- Storage ---- */

export async function uploadPhoto(path, blob) {
  if (!isConfigured()) throw new Error('Backend not configured');
  const { url } = backend();
  const res = await fetch(`${url}/storage/v1/object/photos/${path}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' },
    body: blob,
  });
  if (!res.ok) {
    const err = new Error(await readError(res));
    err.status = res.status;
    throw err;
  }
  return publicPhotoUrl(path);
}

/** The bucket is public, so reads need no token and can be cached like any image. */
export function publicPhotoUrl(path) {
  if (!isConfigured()) return null;
  return `${backend().url}/storage/v1/object/public/photos/${path}`;
}

/** Fetch a photo's bytes so it can be cached locally and shown offline. */
export async function downloadPhoto(path) {
  const url = publicPhotoUrl(path);
  if (!url) throw new Error('Backend not configured');
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(await readError(res));
    err.status = res.status;
    throw err;
  }
  return res.blob();
}
