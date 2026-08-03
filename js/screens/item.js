// One item: how much, where, and what has happened to it.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { itemRepo, isLow, expiryState, fmtQty } from '../data/items.js';
import { categoryRepo } from '../data/categories.js';
import { locationRepo } from '../data/locations.js';
import { itemForm, moveItem } from '../ui/item-form.js';
import { stepper } from '../ui/stepper.js';
import { sheet, close, confirmSheet } from '../ui/sheet.js';
import { toast, errorToast } from '../ui/toast.js';
import { go, refresh } from '../core/router.js';
import * as idb from '../core/idb.js';

export default async function item({ id }) {
  const row = await itemRepo.get(id);
  if (!row || row.deleted_at) {
    return empty({
      glyph: ICONS.warn,
      title: 'That item is gone',
      body: 'It was deleted, or this phone has not synced yet.',
      action: el('a', { class: 'btn', href: '#/inventory', text: 'All items' }),
    });
  }

  const [categories, place, history, members] = await Promise.all([
    categoryRepo.map(),
    row.location_id ? idb.get('locations', row.location_id) : null,
    itemRepo.history(row.id),
    idb.all('members'),
  ]);

  const memberName = new Map(members.map(m => [m.id, m.display_name]));
  const path = place ? await locationRepo.path(place.id) : null;
  const expiry = expiryState(row);

  const control = stepper(row, { onChange: () => {} });
  // Any navigation away must not lose a half-finished tap sequence.
  window.addEventListener('hashchange', () => control.commit?.(), { once: true });

  return el('div', { class: 'stack' }, [
    el('div', { class: 'place-head' }, [
      el('div', {}, [
        el('h2', { class: 'place-name', text: row.name }),
        el('div', { class: 'row-sub', text: categories.get(row.category_id)?.name ?? 'Uncategorised' }),
      ]),
      el('button', {
        class: 'icon-btn', 'aria-label': 'Item options',
        onclick: () => options(row),
      }, [icon('<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>', 22)]),
    ]),

    el('div', { class: 'card qty-card' }, [
      control,
      isLow(row) ? el('span', { class: 'badge badge-warn', text: `Low — keep at least ${fmtQty(row.min_quantity)}` }) : null,
      expiry === 'expired' ? el('span', { class: 'badge badge-danger', text: `Expired ${row.expires_on}` })
        : expiry === 'soon' ? el('span', { class: 'badge badge-warn', text: `Expires ${row.expires_on}` })
        : row.expires_on ? el('span', { class: 'badge badge-info', text: `Expires ${row.expires_on}` }) : null,
    ]),

    el('div', { class: 'list' }, [
      place
        ? el('a', { class: 'row', href: `#/l/${place.qr_slug}` }, [
            el('span', { class: 'row-icon' }, [icon(ICONS.pin, 20)]),
            el('div', { class: 'row-main' }, [
              el('div', { class: 'row-title', text: place.name }),
              el('div', { class: 'row-sub', text: path }),
            ]),
            el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
          ])
        : el('button', { class: 'row', onclick: () => moveItem({ item: row, onDone: refresh }) }, [
            el('span', { class: 'row-icon' }, [icon(ICONS.pin, 20)]),
            el('div', { class: 'row-main' }, [
              el('div', { class: 'row-title', text: 'No place set' }),
              el('div', { class: 'row-sub', text: 'Tap to say where it lives' }),
            ]),
          ]),
    ]),

    row.notes ? el('p', { class: 'help selectable', text: row.notes }) : null,

    el('div', { class: 'section-title', text: 'History' }),
    history.length
      ? el('div', { class: 'list' }, history.map(e => eventRow(e, memberName)))
      : el('p', { class: 'help', text: 'Nothing recorded yet.' }),
  ]);
}

const EVENT_LABEL = {
  add: 'Added', consume: 'Used', restock: 'Restocked', adjust: 'Adjusted',
  move: 'Moved', discard: 'Removed', expire: 'Expired',
};

function eventRow(event, memberName) {
  const delta = Number(event.delta ?? 0);
  const when = new Date(event.created_at);
  const sign = delta > 0 ? `+${fmtQty(delta)}` : delta < 0 ? fmtQty(delta) : '';

  return el('div', { class: 'row' }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: EVENT_LABEL[event.type] ?? event.type }),
      el('div', { class: 'row-sub', text:
        `${memberName.get(event.member_id) ?? 'Someone'} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }),
    ]),
    sign ? el('span', { class: `badge ${delta > 0 ? 'badge-ok' : 'badge-warn'}`, text: sign }) : null,
  ]);
}

function options(row) {
  const act = fn => () => { close(); fn(); };

  sheet({
    title: row.name,
    body: el('div', { class: 'list' }, [
      el('button', { class: 'row', onclick: act(() => itemForm({ item: row, onDone: refresh })) },
        [el('div', { class: 'row-main' }, [el('div', { class: 'row-title', text: 'Edit details' })])]),
      el('button', { class: 'row', onclick: act(() => moveItem({ item: row, onDone: refresh })) },
        [el('div', { class: 'row-main' }, [el('div', { class: 'row-title', text: 'Move to another place' })])]),
      el('button', { class: 'row', onclick: act(() => setExact(row)) },
        [el('div', { class: 'row-main' }, [el('div', { class: 'row-title', text: 'Set exact quantity' })])]),
      el('button', { class: 'row', onclick: act(() => remove(row)) },
        [el('div', { class: 'row-main' }, [el('div', { class: 'row-title danger', text: 'Delete item' })])]),
    ]),
  });
}

/** For when you have counted the shelf and want to just say what is there. */
function setExact(row) {
  const field = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any',
    value: String(row.quantity ?? 0),
  });

  const apply = async () => {
    const target = Number(field.value);
    if (!Number.isFinite(target) || target < 0) return errorToast('Enter a number of zero or more.');
    await itemRepo.setQuantity(row.id, target);
    close();
    toast(`${row.name}: now ${fmtQty(target)}`);
    refresh();
  };

  field.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });

  sheet({
    title: `How many ${row.name}?`,
    body: el('div', { class: 'stack-sm' }, [
      el('p', { class: 'help', text: 'Recorded as an adjustment, so the history still adds up.' }),
      field,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'Set', onclick: apply }),
    ],
  });
}

async function remove(row) {
  const ok = await confirmSheet({
    title: `Delete ${row.name}?`,
    message: 'It disappears from every phone. The history is kept.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await itemRepo.remove(row.id);
  toast(`Deleted ${row.name}`);
  go('/inventory', { replace: true });
}
