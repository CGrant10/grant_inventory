// Purchases: the receipt, and what it entitles you to.
//
// One row per thing bought. Optionally attached to an item you stock, but not
// required — the water heater is worth a warranty record even though nobody
// counts water heaters on a shelf.
//
// `name` is stored on the purchase rather than read through item_id, so deleting
// the item does not turn a receipt into a blank line.

import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';
import { addInterval, today, daysBetween } from '../core/model.js';

const base = makeRepo('purchases');

export const purchaseRepo = {
  ...base,

  /** Newest first; undated purchases sort last rather than to the top. */
  async list() {
    const rows = await idb.all('purchases');
    return rows.sort((a, b) =>
      String(b.purchased_on ?? '0000-00-00').localeCompare(String(a.purchased_on ?? '0000-00-00')));
  },

  async forItem(itemId) {
    const rows = await idb.where('purchases', 'item_id', itemId);
    return rows
      .filter(p => !p.deleted_at)
      .sort((a, b) => String(b.purchased_on ?? '').localeCompare(String(a.purchased_on ?? '')));
  },

  async create({ name, item_id = null, vendor = null, purchased_on = null, price = null,
                 quantity = 1, warranty_until = null, serial_number = null,
                 model_number = null, notes = null }) {
    return base.create({
      item_id,
      name: String(name).trim(),
      vendor: trimmed(vendor),
      purchased_on: purchased_on || null,
      price: price === '' || price == null ? null : Number(price),
      quantity: Number(quantity) || 1,
      warranty_until: warranty_until || null,
      serial_number: trimmed(serial_number),
      model_number: trimmed(model_number),
      notes: trimmed(notes),
    });
  },

  async remove(id) {
    return base.softDelete(id);
  },

  /** Everything still under warranty, soonest to expire first. */
  async underWarranty() {
    const rows = await idb.all('purchases');
    return rows
      .filter(p => warrantyState(p) === 'active' || warrantyState(p) === 'soon')
      .sort((a, b) => a.warranty_until.localeCompare(b.warranty_until));
  },

  /** Warranties about to lapse — the one thing worth interrupting someone about. */
  async lapsingSoon(days = 30) {
    const rows = await idb.all('purchases');
    return rows
      .filter(p => p.warranty_until && warrantyState(p, days) === 'soon')
      .sort((a, b) => a.warranty_until.localeCompare(b.warranty_until));
  },
};

function trimmed(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

/**
 * Warranty end date from a purchase date and a number of months, using the same
 * calendar arithmetic as maintenance schedules: one year from 29 February is
 * 28 February, not 1 March.
 */
export function warrantyEnd(purchasedOn, months) {
  if (!purchasedOn || !months) return null;
  return addInterval(purchasedOn, Number(months), 'month');
}

/**
 * `null` when nothing was recorded, so a missing warranty and an expired one
 * never render the same way.
 */
export function warrantyState(purchase, soonDays = 60) {
  if (!purchase?.warranty_until || purchase.deleted_at) return null;
  const days = daysBetween(today(), purchase.warranty_until);
  if (days < 0) return 'expired';
  return days <= soonDays ? 'soon' : 'active';
}

export function warrantyLabel(purchase) {
  const state = warrantyState(purchase);
  if (!state) return null;
  const days = daysBetween(today(), purchase.warranty_until);
  if (state === 'expired') return `Warranty ended ${purchase.warranty_until}`;
  if (days === 0) return 'Warranty ends today';
  if (days === 1) return 'Warranty ends tomorrow';
  if (days < 60) return `Warranty ends in ${days} days`;
  const months = Math.round(days / 30);
  return months < 24
    ? `Under warranty for ${months} more months`
    : `Under warranty until ${purchase.warranty_until}`;
}

const MONEY = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

export function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return MONEY.format(n);
}

/** Whole dollars, for headline figures where the cents are noise. */
export function fmtMoneyShort(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return MONEY.format(Math.round(n)).replace(/\.00$/, '');
}
