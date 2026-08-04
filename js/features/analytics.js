// Analytics: what the household actually consumes, and what it spends.
//
// Everything here is a pure function over rows the app already stores — the
// item_events log and the purchases table — so nothing new has to be collected
// and every figure can be tested without a database. `asOf` is a parameter for
// the same reason: a report whose answer depends on the wall clock cannot be
// checked.
//
// Money and quantities are deliberately never mixed. "Used 12 rolls" and "spent
// $40" are different questions and get different sections.

import { daysBetween, addInterval, today } from '../core/model.js';

/** Events count towards a window if their date falls inside it, inclusive. */
function within(dateIso, days, asOf) {
  if (!dateIso) return false;
  const age = daysBetween(String(dateIso).slice(0, 10), asOf);
  return age >= 0 && age < days;
}

function live(rows) {
  return rows.filter(r => !r.deleted_at);
}

/* ------------------------------------------------------------- Consumption */

/**
 * How fast each item is going, and how long what's on the shelf will last.
 *
 * Only 'consume' events count. Adjustments are corrections to a miscount, not
 * usage, and treating them as usage makes a single recount look like a spike.
 *
 * @returns {Array<{item, used, perDay, daysLeft, runsOutOn}>} fastest to run out first.
 */
export function usageStats(events, items, { days = 90, asOf = today() } = {}) {
  const used = new Map();

  for (const e of events) {
    if (e.type !== 'consume') continue;
    if (!within(e.created_at, days, asOf)) continue;
    used.set(e.item_id, (used.get(e.item_id) ?? 0) + Math.abs(Number(e.delta) || 0));
  }

  const out = [];
  for (const item of live(items)) {
    const total = used.get(item.id) ?? 0;
    if (total <= 0) continue;

    const perDay = total / days;
    const quantity = Number(item.quantity) || 0;
    // Rounded down: "lasts 3 more days" being optimistic is the failure that
    // matters, so a part-day never gets counted as a whole one.
    const daysLeft = perDay > 0 ? Math.floor(quantity / perDay) : Infinity;

    out.push({
      item,
      used: total,
      perDay,
      daysLeft,
      runsOutOn: Number.isFinite(daysLeft) ? addInterval(asOf, daysLeft, 'day') : null,
    });
  }

  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** The same numbers, ordered by how much gets used rather than what runs out. */
export function topUsed(events, items, { days = 90, asOf = today(), limit = 8 } = {}) {
  return usageStats(events, items, { days, asOf })
    .sort((a, b) => b.used - a.used)
    .slice(0, limit);
}

/** Who has been doing things, over a window. Members with nothing are dropped. */
export function memberActivity(events, members, { days = 30, asOf = today() } = {}) {
  const counts = new Map();
  for (const e of events) {
    if (!within(e.created_at, days, asOf)) continue;
    counts.set(e.member_id, (counts.get(e.member_id) ?? 0) + 1);
  }

  const name = new Map(members.map(m => [m.id, m.display_name]));
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: name.get(id) ?? 'Someone', count }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ Spending */

/** '2026-08' — the key months are grouped by. */
export function monthKey(dateIso) {
  return String(dateIso ?? '').slice(0, 7);
}

/** The last N month keys ending at `asOf`, oldest first. */
export function monthsBack(count, asOf = today()) {
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(addInterval(`${monthKey(asOf)}-01`, -i, 'month')));
  }
  return keys;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(key) {
  const month = Number(String(key).slice(5, 7));
  return MONTH_LABELS[month - 1] ?? key;
}

/**
 * Spend per calendar month, including the months nothing was spent — a gap in
 * the middle of a bar chart is information, and dropping it lies about the shape.
 */
export function spendByMonth(purchases, { months = 12, asOf = today() } = {}) {
  const keys = monthsBack(months, asOf);
  const totals = new Map(keys.map(k => [k, 0]));

  for (const p of live(purchases)) {
    const key = monthKey(p.purchased_on);
    if (!totals.has(key)) continue;
    totals.set(key, totals.get(key) + (Number(p.price) || 0));
  }

  return keys.map(key => ({ key, label: monthLabel(key), total: totals.get(key) }));
}

/** Undated purchases are excluded from windowed totals — there is no honest bucket. */
export function spendTotal(purchases, { from = null, to = null } = {}) {
  let total = 0;
  for (const p of live(purchases)) {
    if (!p.purchased_on) continue;
    if (from && p.purchased_on < from) continue;
    if (to && p.purchased_on > to) continue;
    total += Number(p.price) || 0;
  }
  return total;
}

/**
 * Where the money went. Purchases with no seller recorded are grouped, not hidden.
 *
 * Grouped case-insensitively and displayed under the first spelling seen:
 * "menards" and "Menards" are one shop, and splitting them into two lines makes
 * the chart wrong in the one way nobody would think to check.
 */
export function spendByVendor(purchases, { from = null, to = null, limit = 6 } = {}) {
  const totals = new Map();

  for (const p of live(purchases)) {
    if (!Number(p.price)) continue;
    if (from && (!p.purchased_on || p.purchased_on < from)) continue;
    if (to && (!p.purchased_on || p.purchased_on > to)) continue;

    const vendor = p.vendor?.trim() || 'Not recorded';
    const key = vendor.toLowerCase();
    const seen = totals.get(key);
    totals.set(key, { vendor: seen?.vendor ?? vendor, total: (seen?.total ?? 0) + Number(p.price) });
  }

  return [...totals.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/** First day of the month `asOf` falls in — the boundary "this month" means. */
export function monthStart(asOf = today()) {
  return `${monthKey(asOf)}-01`;
}

/** The same day last year, for a rolling twelve-month total. */
export function yearStart(asOf = today()) {
  return addInterval(asOf, -12, 'month');
}
