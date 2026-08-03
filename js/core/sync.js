// Sync engine: drain the outbox, then pull whatever changed since last time.
//
// Push  — queued mutations, in order, idempotent (client-generated UUIDs + upsert).
// Pull  — per-table cursor on updated_at (created_at for append-only tables).
// Merge — last-write-wins on scalars. Quantities never travel as absolutes; they
//         travel as item_events deltas that a database trigger applies, so two
//         phones decrementing the same item offline cannot lose a write.

import * as idb from './idb.js';
import * as sb from './supabase.js';
import { TABLE_NAMES, APPEND_ONLY } from './model.js';
import { emit, EVENTS } from './bus.js';
import { isConfigured, PULL_INTERVAL_MS } from './config.js';
import { isSyncing } from './auth.js';

let running = false;
let queued = false;
let timer = null;

function setState(state) {
  emit(EVENTS.SYNC_STATE, state);
}

function cursorColumn(table) {
  return APPEND_ONLY.has(table) ? 'created_at' : 'updated_at';
}

function cursorKey(table) {
  return `cursor:${table}`;
}

/** Request a sync. Coalesces — a call during a run schedules exactly one more. */
export function kick() {
  if (running) { queued = true; return; }
  sync();
}

export async function sync() {
  if (running) { queued = true; return; }
  if (!isSyncing() || !isConfigured()) { setState('local'); return; }
  if (!navigator.onLine) { setState('offline'); return; }

  running = true;
  setState('syncing');
  try {
    await push();
    await pull();
    await idb.setMeta('last_sync', new Date().toISOString());
    setState('synced');
  } catch (err) {
    console.error('[sync]', err);
    setState(navigator.onLine ? 'error' : 'offline');
  } finally {
    running = false;
    if (queued) { queued = false; kick(); }
  }
}

/* ---- Push ---- */

const MAX_TRIES = 5;

async function push() {
  const ops = await idb.outboxAll();
  if (!ops.length) return;

  // Batch consecutive upserts to the same table into one request.
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    const table = batch[0].table;
    const sending = batch;
    batch = [];

    // Collapse repeats before sending. PostgREST turns the array into a single
    // INSERT ... ON CONFLICT DO UPDATE, and Postgres refuses to update the same
    // row twice in one command — so a create followed by an edit of the same
    // record, both still queued, would fail the request forever and wedge the
    // whole outbox. Ops are in sequence order, so keeping the last payload per
    // id is exactly what applying them one at a time would produce.
    const latest = new Map();
    for (const op of sending) latest.set(op.payload.id, op.payload);

    try {
      await sb.upsert(table, [...latest.values()]);
      for (const op of sending) await idb.outboxDelete(op.id);
    } catch (err) {
      // One bad row must not block every later write. Count attempts, and give
      // up on an op that will clearly never succeed — parked in _meta so it can
      // be inspected rather than vanishing.
      const dead = [];
      for (const op of sending) {
        const tries = (op.tries || 0) + 1;
        if (tries >= MAX_TRIES) {
          dead.push({ table, payload: op.payload, error: err.message });
          await idb.outboxDelete(op.id);
        } else {
          await idb.outboxAdd({ ...op, tries });
        }
      }
      if (dead.length) {
        const parked = await idb.meta('failed_ops', []);
        await idb.setMeta('failed_ops', [...parked, ...dead].slice(-50));
        console.error(`[sync] gave up on ${dead.length} write(s) to ${table}`, err);
      }
      throw err;
    }
  };

  for (const op of ops) {
    if (op.kind !== 'upsert') continue;
    if (batch.length && batch[0].table !== op.table) await flush();
    batch.push(op);
    if (batch.length >= 200) await flush();
  }
  await flush();
}

/* ---- Pull ---- */

async function pull() {
  const touched = new Set();

  for (const table of TABLE_NAMES) {
    const column = cursorColumn(table);
    let cursor = await idb.meta(cursorKey(table), null);

    // Page until the server stops handing back full pages.
    for (;;) {
      const rows = await sb.selectSince(table, column, cursor, 1000);
      if (!rows?.length) break;

      await idb.putMany(table, rows);
      cursor = rows[rows.length - 1][column];
      await idb.setMeta(cursorKey(table), cursor);
      touched.add(table);

      if (rows.length < 1000) break;
    }
  }

  for (const table of touched) emit(EVENTS.DATA_CHANGED, { table });
}

/* ---- Lifecycle ---- */

export function start() {
  stop();
  kick();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') kick();
  }, PULL_INTERVAL_MS);

  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', onVisible);
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener('online', kick);
  document.removeEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (document.visibilityState === 'visible') kick();
}

export async function status() {
  return {
    pending: await idb.outboxCount(),
    lastSync: await idb.meta('last_sync', null),
  };
}

/** Forget every cursor so the next pull re-downloads everything. */
export async function resetCursors() {
  for (const table of TABLE_NAMES) await idb.setMeta(cursorKey(table), null);
}
