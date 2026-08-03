// The shopping list.
//
// Two kinds of line: ones you typed, and ones the app added because something
// dropped to its minimum. The difference matters — an automatic line disappears
// on its own when the shelf refills, a typed one never does.

import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';
import { itemRepo } from './items.js';
import { device } from '../core/auth.js';
import { nowIso } from '../core/model.js';

const base = makeRepo('shopping_items');

export const STATUS = { NEEDED: 'needed', IN_CART: 'in_cart', PURCHASED: 'purchased' };

export const shoppingRepo = {
  ...base,

  async list() {
    const rows = await idb.all('shopping_items');
    return rows.sort((a, b) =>
      a.name.localeCompare(b.name));
  },

  async byStatus(status) {
    return (await this.list()).filter(r => r.status === status);
  },

  /** The automatic line for an item, if there is one. */
  async autoFor(itemId) {
    const all = await idb.all('shopping_items');
    return all.find(r => r.item_id === itemId && r.auto_generated) ?? null;
  },

  async add({ name, quantity = 1, unit = 'ea', item_id = null, product_id = null,
              auto_generated = false, note = null }) {
    return base.create({
      name: String(name).trim(),
      quantity: Number(quantity) || 1,
      unit,
      item_id,
      product_id,
      auto_generated,
      note,
      status: STATUS.NEEDED,
      purchased_at: null,
      purchased_by: null,
    });
  },

  setStatus(id, status) {
    return base.update(id, { status });
  },

  setQuantity(id, quantity) {
    return base.update(id, { quantity: Math.max(0, Number(quantity) || 0) });
  },

  /**
   * Tick it off. If the line came from something we track, the purchase goes
   * straight back into stock — that is the whole point of the round trip, and
   * doing it by hand afterwards is exactly the step people skip.
   */
  async purchase(id) {
    const row = await idb.get('shopping_items', id);
    if (!row) throw new Error('Not on the list');

    let restocked = null;
    if (row.item_id) {
      const item = await itemRepo.get(row.item_id);
      if (item && !item.deleted_at) {
        const { item: updated } = await itemRepo.restock(row.item_id, Number(row.quantity) || 1);
        restocked = updated;
      }
    }

    const saved = await base.update(id, {
      status: STATUS.PURCHASED,
      purchased_at: nowIso(),
      purchased_by: device().id,
    });
    return { line: saved, restocked };
  },

  /** Undo a tick: take the quantity back out and put the line back on the list. */
  async unpurchase(id) {
    const row = await idb.get('shopping_items', id);
    if (!row) return null;

    if (row.item_id && row.status === STATUS.PURCHASED) {
      const item = await itemRepo.get(row.item_id);
      if (item && !item.deleted_at) {
        await itemRepo.adjustBy(row.item_id, -(Number(row.quantity) || 1), 'adjust', 'unticked');
      }
    }
    return base.update(id, { status: STATUS.NEEDED, purchased_at: null, purchased_by: null });
  },

  /** Clear the bought pile. Soft deleted, so other phones lose it too. */
  async clearPurchased() {
    const done = await this.byStatus(STATUS.PURCHASED);
    for (const row of done) await base.softDelete(row.id);
    return done.length;
  },
};
