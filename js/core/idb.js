// IndexedDB mirror of the Supabase tables. This is the app's read path — every
// screen reads from here, so the UI is instant and works with no network.
//
// Stores: one per table in model.js, plus:
//   _meta   key/value — sync cursors, device identity, settings
//   _outbox queued mutations waiting to reach the server
//   _blobs  photos captured offline, awaiting upload

import { TABLES, TABLE_NAMES } from './model.js';

const DB_NAME = 'grant-inventory';
// Bumped to 2 for the maintenance tables. The upgrade path creates whatever
// stores TABLES lists and are missing, so adding a table is a bump and nothing else.
const DB_VERSION = 2;

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      for (const [name, spec] of Object.entries(TABLES)) {
        const store = db.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: 'id' });

        for (const idx of spec.indexes) {
          if (!store.indexNames.contains(idx)) store.createIndex(idx, idx);
        }
      }

      if (!db.objectStoreNames.contains('_meta')) db.createObjectStore('_meta');
      if (!db.objectStoreNames.contains('_outbox')) {
        db.createObjectStore('_outbox', { keyPath: 'id' })
          .createIndex('seq', 'seq');
      }
      if (!db.objectStoreNames.contains('_blobs')) {
        db.createObjectStore('_blobs', { keyPath: 'id' });
      }
    };

    // Another tab holding the previous version open will block the upgrade, and
    // the default behaviour is to wait for ever with no explanation. Say so.
    req.onblocked = () => {
      console.warn('[idb] upgrade blocked — this app is open in another tab');
      reject(new Error('The app is open in another tab. Close it and reload to finish updating.'));
    };

    req.onsuccess = () => {
      const db = req.result;
      // If a newer version appears elsewhere, let go rather than block it.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(db, stores, mode) {
  return db.transaction(stores, mode);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/* ---- Records ---- */

export async function get(table, id) {
  const db = await open();
  return wrap(tx(db, table, 'readonly').objectStore(table).get(id));
}

/**
 * Read a whole table. Soft-deleted rows are hidden unless includeDeleted is set —
 * tombstones live in the store so sync can propagate them, but screens never see them.
 */
export async function all(table, { includeDeleted = false } = {}) {
  const db = await open();
  const rows = await wrap(tx(db, table, 'readonly').objectStore(table).getAll());
  return includeDeleted ? rows : rows.filter(r => !r.deleted_at);
}

export async function where(table, index, value, { includeDeleted = false } = {}) {
  const db = await open();
  const store = tx(db, table, 'readonly').objectStore(table);
  const source = store.indexNames.contains(index) ? store.index(index) : null;
  const rows = source
    ? await wrap(source.getAll(value))
    : (await wrap(store.getAll())).filter(r => r[index] === value);
  return includeDeleted ? rows : rows.filter(r => !r.deleted_at);
}

export async function put(table, record) {
  const db = await open();
  const t = tx(db, table, 'readwrite');
  t.objectStore(table).put(record);
  await done(t);
  return record;
}

export async function putMany(table, records) {
  if (!records.length) return;
  const db = await open();
  const t = tx(db, table, 'readwrite');
  const store = t.objectStore(table);
  for (const r of records) store.put(r);
  await done(t);
}

export async function remove(table, id) {
  const db = await open();
  const t = tx(db, table, 'readwrite');
  t.objectStore(table).delete(id);
  await done(t);
}

export async function clearAll() {
  const db = await open();
  const stores = [...TABLE_NAMES, '_outbox', '_blobs'];
  const t = tx(db, stores, 'readwrite');
  for (const s of stores) t.objectStore(s).clear();
  await done(t);
}

/* ---- Meta ---- */

export async function meta(key, fallback = null) {
  const db = await open();
  const value = await wrap(tx(db, '_meta', 'readonly').objectStore('_meta').get(key));
  return value === undefined ? fallback : value;
}

export async function setMeta(key, value) {
  const db = await open();
  const t = tx(db, '_meta', 'readwrite');
  t.objectStore('_meta').put(value, key);
  await done(t);
  return value;
}

/* ---- Outbox ---- */

export async function outboxAdd(op) {
  const db = await open();
  const t = tx(db, '_outbox', 'readwrite');
  t.objectStore('_outbox').put(op);
  await done(t);
}

export async function outboxAll() {
  const db = await open();
  const rows = await wrap(tx(db, '_outbox', 'readonly').objectStore('_outbox').getAll());
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function outboxDelete(id) {
  const db = await open();
  const t = tx(db, '_outbox', 'readwrite');
  t.objectStore('_outbox').delete(id);
  await done(t);
}

export async function outboxCount() {
  const db = await open();
  return wrap(tx(db, '_outbox', 'readonly').objectStore('_outbox').count());
}

/* ---- Blobs (offline photos) ---- */

export async function blobPut(id, blob, entity) {
  const db = await open();
  const t = tx(db, '_blobs', 'readwrite');
  t.objectStore('_blobs').put({ id, blob, entity, created_at: new Date().toISOString() });
  await done(t);
}

export async function blobGet(id) {
  const db = await open();
  return wrap(tx(db, '_blobs', 'readonly').objectStore('_blobs').get(id));
}

export async function blobDelete(id) {
  const db = await open();
  const t = tx(db, '_blobs', 'readwrite');
  t.objectStore('_blobs').delete(id);
  await done(t);
}
