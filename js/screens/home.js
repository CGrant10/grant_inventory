// Dashboard.
//
// Home answers one question — is there anything I need to do? — and then gets
// out of the way. Everything else the app can show is one tap away in the tab
// bar or under House, and repeating it here as a wall of tiles only buried the
// answer under its own table of contents.
//
// What earns a place on this screen: something time-sensitive, something done
// often, or something with nowhere else to live. Counts of things you already
// own are none of those, so they sit quietly at the bottom instead of leading in
// the largest type on the screen.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import * as idb from '../core/idb.js';
import { reconcile } from '../features/low-stock.js';
import { isLow, expiryState, fmtQty } from '../data/items.js';
import { dueState, dueLabel } from '../data/maintenance.js';
import { warrantyState, warrantyLabel } from '../data/purchases.js';

export default async function home() {
  // Bring the shopping list in step first, or the "to buy" figure here disagrees
  // with the list itself — which is worse than being slightly slow.
  await reconcile();

  const [items, locations, shopping, tasks, purchases] = await Promise.all([
    idb.all('items'),
    idb.all('locations'),
    idb.all('shopping_items'),
    idb.all('maintenance_tasks').catch(() => []),
    idb.all('purchases').catch(() => []),
  ]);

  if (!items.length && !locations.length) return firstRun();

  const needed = shopping.filter(s => s.status === 'needed' || s.status === 'in_cart');
  const rows = attention({ items, tasks, purchases });

  return el('div', { class: 'stack' }, [
    rows.length
      ? el('div', { class: 'list' }, rows.map(attentionRow))
      : allClear(),

    // The one action with nowhere else to live. Scanning, shopping and the item
    // list are all permanent tabs; searching is in the top bar.
    el('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/quick' },
      [icon(ICONS.minus, 22), el('span', { text: 'Quick log' })]),
    el('a', { class: 'btn btn-block', href: '#/inventory?add=1' },
      [icon(ICONS.plus, 20), el('span', { text: 'Add an item' })]),

    el('div', { class: 'tally' }, [
      tally(items.length, items.length === 1 ? 'item' : 'items', '#/inventory'),
      tally(locations.length, locations.length === 1 ? 'place' : 'places', '#/locations'),
      tally(needed.length, 'to buy', '#/shopping', needed.length ? 'accent' : null),
    ]),
  ]);
}

/**
 * Everything that wants a decision, worst first.
 *
 * One row per kind rather than one per thing: five separate "running low" lines
 * push the overdue furnace filter off the screen, and the filter is the more
 * important of the two. A row names the thing when there is only one of it, and
 * counts them when there are several — which is the way anyone would say it out
 * loud.
 */
function attention({ items, tasks, purchases }) {
  const expired = items.filter(i => expiryState(i) === 'expired');
  const soon = items.filter(i => expiryState(i) === 'soon');
  const low = items.filter(isLow);
  const overdue = tasks.filter(t => dueState(t).state === 'overdue');
  const today = tasks.filter(t => dueState(t).state === 'today');
  const lapsing = purchases.filter(p => !p.deleted_at && warrantyState(p, 30) === 'soon');

  const rows = [];

  if (expired.length) rows.push({
    tone: 'danger', glyph: ICONS.warn,
    title: expired.length === 1
      ? `${expired[0].name} has expired`
      : `${expired.length} items have expired`,
    sub: expired.length === 1 ? `Expired ${expired[0].expires_on}` : names(expired),
    href: '#/inventory?filter=expiring',
  });

  if (overdue.length) rows.push({
    tone: 'danger', glyph: ICONS.clock,
    title: overdue.length === 1
      ? overdue[0].name
      : `${overdue.length} maintenance jobs are overdue`,
    sub: overdue.length === 1 ? dueLabel(overdue[0]) : names(overdue),
    href: '#/maintenance',
  });

  if (today.length) rows.push({
    tone: 'warn', glyph: ICONS.clock,
    title: today.length === 1 ? today[0].name : `${today.length} jobs are due today`,
    sub: 'Due today',
    href: '#/maintenance',
  });

  if (lapsing.length) rows.push({
    tone: 'warn', glyph: ICONS.receipt,
    title: lapsing.length === 1
      ? lapsing[0].name
      : `${lapsing.length} warranties end within 30 days`,
    sub: lapsing.length === 1 ? warrantyLabel(lapsing[0]) : names(lapsing),
    href: '#/purchases',
  });

  if (low.length) rows.push({
    tone: 'warn', glyph: ICONS.cart,
    title: low.length === 1
      ? `${low[0].name} is running low`
      : `${low.length} things are running low`,
    sub: low.length === 1
      ? `${fmtQty(low[0].quantity)} ${low[0].unit || ''} left, keep ${fmtQty(low[0].min_quantity)}`.replace(/\s+/g, ' ')
      : names(low),
    href: '#/inventory?filter=low',
  });

  if (soon.length) rows.push({
    tone: 'info', glyph: ICONS.box,
    title: soon.length === 1
      ? `${soon[0].name} expires soon`
      : `${soon.length} things expire soon`,
    sub: soon.length === 1 ? `Expires ${soon[0].expires_on}` : names(soon),
    href: '#/inventory?filter=expiring',
  });

  return rows;
}

/** "Milk, Coffee and 3 more" — enough to recognise, not enough to scroll. */
function names(list, shown = 2) {
  const named = list.slice(0, shown).map(x => x.name).join(', ');
  const rest = list.length - shown;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

function attentionRow({ tone, glyph, title, sub, href }) {
  return el('a', { class: 'row', href }, [
    el('span', { class: `row-icon is-${tone}` }, [icon(glyph, 20)]),
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: title }),
      el('div', { class: 'row-sub', text: sub }),
    ]),
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}

/**
 * The reward state, and the reason the list above is worth keeping short: it has
 * to be possible to get to the bottom of it.
 */
function allClear() {
  return el('div', { class: 'all-clear' }, [
    icon('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>', 30),
    el('div', {}, [
      el('div', { class: 'all-clear-title', text: 'Nothing needs you' }),
      el('div', { class: 'all-clear-body', text:
        'Nothing has expired, nothing is running low, and the house is up to date.' }),
    ]),
  ]);
}

function tally(value, label, href, tone) {
  return el('a', { class: 'tally-item', href }, [
    el('div', { class: `tally-value ${tone ? `is-${tone}` : ''}`, text: String(value) }),
    el('div', { class: 'tally-label', text: label }),
  ]);
}

function firstRun() {
  return el('div', { class: 'stack' }, [
    el('div', { class: 'hero-card' }, [
      el('h2', { class: 'hero-title', text: 'Let’s set up your house' }),
      el('p', { class: 'hero-body', text:
        'Start with the places things live — pantry shelves, the freezer, garage bins. ' +
        'Then scanning an item is enough to know what you have and where it is.' }),
      el('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/locations', text: 'Add your first place' }),
    ]),
    el('p', { class: 'help', text:
      'Everything else lives in the bar at the bottom: your items, the scanner, '
      + 'the shopping list, and everything about the house itself.' }),
  ]);
}

export { empty };
