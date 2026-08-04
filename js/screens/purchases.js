// Receipts and warranties.
//
// Two questions, in the order people ask them: is this still covered, and what
// did we pay for it? Warranties lead, because that is the one with a deadline.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { purchaseRepo, warrantyState, warrantyLabel, fmtMoney, fmtMoneyShort } from '../data/purchases.js';
import { purchaseForm } from '../ui/purchase-form.js';
import { spendTotal, monthStart, yearStart } from '../features/analytics.js';
import { sheet, close, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { refresh } from '../core/router.js';
import { today } from '../core/model.js';

export default async function purchases() {
  const rows = (await purchaseRepo.list()).filter(p => !p.deleted_at);

  const addButton = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => purchaseForm({ onDone: refresh }),
  }, [icon(ICONS.plus, 20), el('span', { text: 'Record a purchase' })]);

  if (!rows.length) {
    return el('div', { class: 'stack' }, [
      empty({
        glyph: ICONS.receipt,
        title: 'No receipts yet',
        body: 'Record what you buy for the house — appliances, tools, materials — and '
            + 'the app keeps track of what is still under warranty and what you have spent.',
      }),
      addButton,
    ]);
  }

  const covered = rows.filter(p => ['active', 'soon'].includes(warrantyState(p)))
    .sort((a, b) => a.warranty_until.localeCompare(b.warranty_until));
  const lapsing = covered.filter(p => warrantyState(p, 30) === 'soon');

  const thisMonth = spendTotal(rows, { from: monthStart(), to: today() });
  const twelve = spendTotal(rows, { from: yearStart(), to: today() });

  return el('div', { class: 'stack' }, [
    lapsing.length ? el('a', { class: 'alert-strip', href: '#/purchases' }, [
      icon(ICONS.warn, 20),
      el('span', { text: `${lapsing.length} warrant${lapsing.length === 1 ? 'y ends' : 'ies end'} within 30 days` }),
    ]) : null,

    el('div', { class: 'stat-grid' }, [
      statTile('This month', fmtMoneyShort(thisMonth)),
      statTile('12 months', fmtMoneyShort(twelve)),
      statTile('Covered', String(covered.length), covered.length ? 'info' : null),
      statTile('Receipts', String(rows.length)),
    ]),

    covered.length ? section('Under warranty', covered.map(warrantyRow)) : null,

    el('div', { class: 'section-title', text: 'Everything bought' }),
    el('div', { class: 'list' }, rows.map(purchaseRow)),

    addButton,
  ]);
}

function section(title, children) {
  return el('div', {}, [
    el('div', { class: 'section-title', text: title }),
    el('div', { class: 'list' }, children),
  ]);
}

// Deliberately smaller than the dashboard tiles: currency needs the room, and
// "$1,204" at 28px wraps on a phone.
function statTile(label, value, tone) {
  return el('div', { class: 'stat' }, [
    el('div', { class: `stat-value stat-money ${tone ? `is-${tone}` : ''}`, text: value }),
    el('div', { class: 'stat-label', text: label }),
  ]);
}

function warrantyRow(purchase) {
  const soon = warrantyState(purchase, 30) === 'soon';
  return el('button', { class: 'row', onclick: () => details(purchase) }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: purchase.name }),
      el('div', { class: 'row-sub', text: warrantyLabel(purchase) }),
    ]),
    soon ? el('span', { class: 'badge badge-warn', text: 'Ending' }) : null,
  ]);
}

function purchaseRow(purchase) {
  const state = warrantyState(purchase);
  const bits = [purchase.purchased_on ?? 'No date', purchase.vendor].filter(Boolean);

  return el('button', { class: 'row', onclick: () => details(purchase) }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: purchase.name }),
      el('div', { class: 'row-sub', text: bits.join(' · ') }),
    ]),
    state === 'expired' ? el('span', { class: 'badge badge-danger', text: 'Warranty over' })
      : state ? el('span', { class: 'badge badge-ok', text: 'Covered' }) : null,
    purchase.price != null
      ? el('span', { class: 'row-amount', text: fmtMoney(purchase.price) })
      : null,
  ]);
}

function details(purchase) {
  const act = fn => () => { close(); fn(); };
  const facts = [
    ['Paid', purchase.price != null ? fmtMoney(purchase.price) : null],
    ['Bought', purchase.purchased_on],
    ['From', purchase.vendor],
    ['How many', Number(purchase.quantity) !== 1 ? String(purchase.quantity) : null],
    ['Warranty', warrantyLabel(purchase)],
    ['Serial', purchase.serial_number],
    ['Model', purchase.model_number],
  ].filter(([, value]) => value);

  sheet({
    title: purchase.name,
    body: el('div', { class: 'stack-sm' }, [
      el('div', { class: 'kv-list' }, facts.map(([label, value]) => el('div', { class: 'kv' }, [
        el('span', { class: 'kv-label', text: label }),
        el('span', { class: 'kv-value selectable', text: value }),
      ]))),
      purchase.notes ? el('p', { class: 'help selectable', text: purchase.notes }) : null,
      purchase.item_id
        ? el('a', { class: 'btn btn-block', href: `#/item/${purchase.item_id}`, text: 'Open the item', onclick: () => close() })
        : null,
      el('div', { class: 'list' }, [
        el('button', { class: 'row', onclick: act(() => purchaseForm({ purchase, onDone: refresh })) },
          [el('div', { class: 'row-main' }, [el('div', { class: 'row-title', text: 'Edit' })])]),
        el('button', { class: 'row', onclick: act(() => remove(purchase)) },
          [el('div', { class: 'row-main' }, [el('div', { class: 'row-title danger', text: 'Delete' })])]),
      ]),
    ]),
  });
}

async function remove(purchase) {
  const ok = await confirmSheet({
    title: `Delete the ${purchase.name} receipt?`,
    message: 'It disappears from every phone, along with its warranty date.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await purchaseRepo.remove(purchase.id);
  toast('Deleted');
  refresh();
}
