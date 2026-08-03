// Dashboard. Answers the four questions the app exists for, at a glance:
// what's low, what's expiring, where things are, what to buy.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import * as idb from '../core/idb.js';
import { reconcile } from '../features/low-stock.js';
import { isLow } from '../data/items.js';

export default async function home() {
  // Bring the shopping list in step first, or the "To buy" figure here disagrees
  // with the list itself — which is worse than being slightly slow.
  await reconcile();

  const [items, locations, shopping] = await Promise.all([
    idb.all('items'),
    idb.all('locations'),
    idb.all('shopping_items'),
  ]);

  if (!items.length && !locations.length) return firstRun();

  const low = items.filter(isLow);
  const soon = expiringSoon(items);
  const needed = shopping.filter(s => s.status === 'needed' || s.status === 'in_cart');

  return el('div', { class: 'stack' }, [
    el('div', { class: 'stat-grid' }, [
      stat('Items', items.length, '/inventory'),
      stat('Places', locations.length, '/locations'),
      stat('Low', low.length, '/inventory?filter=low', low.length ? 'warn' : null),
      stat('To buy', needed.length, '/shopping', needed.length ? 'info' : null),
    ]),

    low.length ? section('Running low', low.slice(0, 5).map(i => itemRow(i, 'warn'))) : null,
    soon.length ? section('Expiring soon', soon.slice(0, 5).map(i => itemRow(i, 'danger'))) : null,

    el('div', { class: 'section-title', text: 'Quick actions' }),
    el('div', { class: 'quick-grid' }, [
      quick('Scan an item', ICONS.box, '#/scan'),
      quick('Add a place', ICONS.pin, '#/locations'),
      quick('Shopping list', ICONS.cart, '#/shopping'),
      quick('Measurements', ICONS.ruler, '#/measurements'),
    ]),
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
    el('div', { class: 'section-title', text: 'Or jump in' }),
    el('div', { class: 'quick-grid' }, [
      quick('Scan an item', ICONS.box, '#/scan'),
      quick('Shopping list', ICONS.cart, '#/shopping'),
      quick('Measurements', ICONS.ruler, '#/measurements'),
      quick('Projects', ICONS.hammer, '#/projects'),
    ]),
  ]);
}

function stat(label, value, href, tone) {
  return el('a', { class: 'stat', href: `#${href}` }, [
    el('div', { class: `stat-value ${tone ? `is-${tone}` : ''}`, text: String(value) }),
    el('div', { class: 'stat-label', text: label }),
  ]);
}

function section(title, rows) {
  return el('div', {}, [
    el('div', { class: 'section-title', text: title }),
    el('div', { class: 'list' }, rows),
  ]);
}

function itemRow(item, tone) {
  return el('a', { class: 'row', href: `#/item/${item.id}` }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: item.name }),
      el('div', { class: 'row-sub', text: `${fmtQty(item.quantity)} ${item.unit || ''}`.trim() }),
    ]),
    el('span', { class: `badge badge-${tone}`, text: tone === 'warn' ? 'Low' : 'Soon' }),
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}

function quick(label, glyph, href) {
  return el('a', { class: 'quick', href }, [icon(glyph, 26), el('span', { text: label })]);
}

function expiringSoon(items, days = 14) {
  const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return items
    .filter(i => i.expires_on && i.expires_on <= limit)
    .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
}

function fmtQty(q) {
  const n = Number(q ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export { empty };
