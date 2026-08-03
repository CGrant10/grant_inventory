// Items: a stock lot of something, in a place.
//
// The one rule that shapes this whole file: `quantity` is NEVER pushed to the
// server. It is owned by the database, computed from the item_events log by a
// trigger. If a client ever sent an absolute quantity, two phones each using one
// can offline would overwrite each other and a can would go missing. Sending
// deltas instead makes the order of arrival irrelevant.
//
// Locally we apply the delta immediately so the UI is instant; the next pull
// replaces our optimistic figure with the server's authoritative one.

import { queueUpsert } from './base.js';
import * as idb from '../core/idb.js';
import { emit, EVENTS } from '../core/bus.js';
import { uuid, nowIso } from '../core/model.js';
import { device } from '../core/auth.js';

/** Everything except the server-owned quantity. */
function pushable(row) {
  const { quantity, ...rest } = row;
  return rest;
}

async function writeLocal(row) {
  await idb.put('items', row);
  emit(EVENTS.DATA_CHANGED, { table: 'items', source: 'local' });
  return row;
}

async function logEvent({ item_id, type, delta = 0, from_location_id = null, to_location_id = null, note = null }) {
  const row = {
    id: uuid(),
    item_id,
    member_id: device().id,
    type,
    delta,
    from_location_id,
    to_location_id,
    note,
    created_at: nowIso(),
  };
  await idb.put('item_events', row);
  await queueUpsert('item_events', row);
  return row;
}

export const itemRepo = {
  get: id => idb.get('items', id),
  all: opts => idb.all('items', opts),
  byLocation: id => idb.where('items', 'location_id', id),

  /**
   * New item. The row is created at zero and an 'add' event carries the opening
   * quantity, so the server arrives at the same number by the same path as every
   * later change — and the history starts with how many you began with.
   */
  async create({ name, quantity = 1, unit = 'ea', location_id = null, category_id = null,
                 min_quantity = null, expires_on = null, notes = null, product_id = null }) {
    const now = nowIso();
    const row = {
      id: uuid(),
      product_id,
      name: String(name).trim(),
      category_id,
      location_id,
      quantity: 0,
      unit,
      min_quantity,
      expires_on: expires_on || null,
      notes: notes || null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };

    await idb.put('items', row);
    await queueUpsert('items', pushable(row));

    const opening = Number(quantity) || 0;
    if (opening !== 0) {
      await logEvent({ item_id: row.id, type: 'add', delta: opening });
      row.quantity = opening;
      await idb.put('items', row);
    }

    emit(EVENTS.DATA_CHANGED, { table: 'items', source: 'local' });
    return row;
  },

  /** Edit the descriptive fields. Quantity is deliberately not accepted here. */
  async update(id, patch) {
    const current = await idb.get('items', id);
    if (!current) throw new Error('Item not found');

    const { quantity, ...safe } = patch;      // ignore quantity if a caller passes it
    const row = { ...current, ...safe, updated_at: nowIso() };
    await idb.put('items', row);
    await queueUpsert('items', pushable(row));
    emit(EVENTS.DATA_CHANGED, { table: 'items', source: 'local' });
    return row;
  },

  /**
   * Change the quantity by a relative amount.
   * @returns {{item: object, event: object}} so callers can offer an undo.
   */
  async adjustBy(id, delta, type = 'adjust', note = null) {
    const current = await idb.get('items', id);
    if (!current) throw new Error('Item not found');

    const amount = Number(delta);
    if (!Number.isFinite(amount) || amount === 0) return { item: current, event: null };

    // Never go negative: you cannot use four cans out of a shelf holding three.
    const next = Math.max(0, Number(current.quantity ?? 0) + amount);
    const applied = next - Number(current.quantity ?? 0);
    if (applied === 0) return { item: current, event: null };

    const event = await logEvent({ item_id: id, type, delta: applied, note });
    const item = await writeLocal({ ...current, quantity: next });
    return { item, event };
  },

  use(id, amount = 1) { return this.adjustBy(id, -Math.abs(amount), 'consume'); },
  restock(id, amount = 1) { return this.adjustBy(id, Math.abs(amount), 'restock'); },

  /** Set an absolute figure by working out the delta that gets there. */
  async setQuantity(id, target) {
    const current = await idb.get('items', id);
    if (!current) throw new Error('Item not found');
    return this.adjustBy(id, Number(target) - Number(current.quantity ?? 0), 'adjust');
  },

  /** Move to another place. The same trigger applies it server-side. */
  async move(id, toLocationId) {
    const current = await idb.get('items', id);
    if (!current) throw new Error('Item not found');
    if ((current.location_id ?? null) === (toLocationId ?? null)) return current;

    await logEvent({
      item_id: id,
      type: 'move',
      from_location_id: current.location_id ?? null,
      to_location_id: toLocationId ?? null,
    });
    return writeLocal({ ...current, location_id: toLocationId ?? null, updated_at: nowIso() });
  },

  async remove(id, { reason = 'discard' } = {}) {
    const current = await idb.get('items', id);
    if (!current) throw new Error('Item not found');
    await logEvent({ item_id: id, type: reason, delta: 0 });
    const row = { ...current, deleted_at: nowIso(), updated_at: nowIso() };
    await idb.put('items', row);
    await queueUpsert('items', pushable(row));
    emit(EVENTS.DATA_CHANGED, { table: 'items', source: 'local' });
    return row;
  },

  async restore(id) {
    return this.update(id, { deleted_at: null });
  },

  /** Newest first. The activity feed for one item. */
  async history(id, limit = 40) {
    const events = await idb.where('item_events', 'item_id', id);
    return events
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
  },

  async lowStock() {
    const items = await idb.all('items');
    return items
      .filter(i => i.min_quantity != null && Number(i.quantity) < Number(i.min_quantity))
      .sort((a, b) => Number(a.quantity) - Number(b.quantity));
  },

  async expiring(days = 30) {
    const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const items = await idb.all('items');
    return items
      .filter(i => i.expires_on && i.expires_on <= limit)
      .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
  },
};

/**
 * Strictly below the minimum, not at it. "Keep at least 2" means two is fine.
 *
 * With <=, buying exactly the shortfall landed on the threshold and the shopping
 * list immediately re-added the line you had just ticked off.
 */
export function isLow(item) {
  return item.min_quantity != null && Number(item.quantity) < Number(item.min_quantity);
}

export function expiryState(item, soonDays = 14) {
  if (!item.expires_on) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (item.expires_on < today) return 'expired';
  const soon = new Date(Date.now() + soonDays * 86400000).toISOString().slice(0, 10);
  return item.expires_on <= soon ? 'soon' : null;
}

/** Trim trailing zeros so "2" doesn't render as "2.00". */
export function fmtQty(value) {
  const n = Number(value ?? 0);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
