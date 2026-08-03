// Repository base. Screens talk to repositories; repositories own the write path.
//
// Every write: stamp the record -> save to IndexedDB -> queue an outbox op -> emit.
// Nothing awaits the network, so the UI is always instant and always offline-safe.

import * as idb from '../core/idb.js';
import { emit, EVENTS } from '../core/bus.js';
import { uuid, nowIso } from '../core/model.js';
import { kick } from '../core/sync.js';

let seq = Date.now();
function nextSeq() { return ++seq; }

/** Queue a row to be pushed. Merged by primary key server-side, so re-sends are safe. */
export async function queueUpsert(table, row) {
  await idb.outboxAdd({
    id: uuid(),
    seq: nextSeq(),
    kind: 'upsert',
    table,
    payload: row,
    tries: 0,
  });
  kick();
}

export function makeRepo(table) {
  return {
    table,

    get: id => idb.get(table, id),
    all: opts => idb.all(table, opts),
    where: (index, value, opts) => idb.where(table, index, value, opts),

    async create(fields) {
      const now = nowIso();
      const row = {
        id: fields.id || uuid(),
        ...fields,
        created_at: fields.created_at || now,
        updated_at: now,
        deleted_at: null,
      };
      await idb.put(table, row);
      await queueUpsert(table, row);
      emit(EVENTS.DATA_CHANGED, { table });
      return row;
    },

    async update(id, patch) {
      const current = await idb.get(table, id);
      if (!current) throw new Error(`${table}/${id} not found`);
      const row = { ...current, ...patch, updated_at: nowIso() };
      await idb.put(table, row);
      await queueUpsert(table, row);
      emit(EVENTS.DATA_CHANGED, { table });
      return row;
    },

    /**
     * Soft delete. The row stays put as a tombstone so other phones learn about
     * the deletion on their next pull; screens filter it out automatically.
     */
    async softDelete(id) {
      return this.update(id, { deleted_at: nowIso() });
    },

    async restore(id) {
      return this.update(id, { deleted_at: null });
    },
  };
}
