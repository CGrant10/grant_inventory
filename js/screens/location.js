// One place. Reached by tapping through the tree, or by scanning the QR code
// stuck to the bin — which is the whole point of the labels.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { locationRepo } from '../data/locations.js';
import { placeForm, movePicker } from '../ui/place-form.js';
import { itemForm } from '../ui/item-form.js';
import { qrElement } from '../ui/qr.js';
import { photoStrip } from '../ui/photo.js';
import { sheet, close, confirmSheet } from '../ui/sheet.js';
import { toast, errorToast } from '../ui/toast.js';
import { go, refresh } from '../core/router.js';
import * as idb from '../core/idb.js';
import { LOCATION_KINDS } from '../core/model.js';

const KIND_LABEL = Object.fromEntries(LOCATION_KINDS.map(k => [k.id, k.label]));

export default async function location({ slug }) {
  const place = await locationRepo.bySlug(slug);

  if (!place) {
    return empty({
      glyph: ICONS.warn,
      title: 'No such place',
      body: 'That label points at a place that has been deleted, or this phone '
          + 'has not synced yet. Pull down in Settings → Sync now.',
      action: el('a', { class: 'btn', href: '#/locations', text: 'All places' }),
    });
  }

  const [ancestors, children, items] = await Promise.all([
    locationRepo.ancestors(place.id),
    locationRepo.children(place.id),
    idb.where('items', 'location_id', place.id),
  ]);

  return el('div', { class: 'stack' }, [
    ancestors.length ? breadcrumb(ancestors) : null,

    el('div', { class: 'place-head' }, [
      el('div', {}, [
        el('h2', { class: 'place-name', text: place.name }),
        el('div', { class: 'row-sub', text: KIND_LABEL[place.kind] ?? 'Place' }),
      ]),
      el('button', {
        class: 'icon-btn',
        'aria-label': 'Place options',
        onclick: () => options(place),
      }, [icon('<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>', 22)]),
    ]),

    place.notes ? el('p', { class: 'help selectable', text: place.notes }) : null,

    // A photo of the bin answers "which one is it?" faster than its name does.
    photoStrip('location', place.id, { onChange: refresh }),

    el('div', { class: 'section-title', text: `What's in here (${items.length})` }),
    items.length
      ? el('div', { class: 'list' }, items.map(itemRow))
      : el('p', { class: 'help', text: 'Nothing recorded here yet.' }),

    // The whole point of the label on the bin: scan it, and the place you are
    // standing in front of is already filled in. Filing a tote's contents should
    // never mean hunting for its name in a list of forty.
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => itemForm({ locationId: place.id, onDone: () => refresh() }),
    }, [icon(ICONS.plus, 20), el('span', { text: 'Add an item here' })]),

    el('div', { class: 'section-title', text: 'Places inside' }),
    children.length
      ? el('div', { class: 'list' }, children.map(childRow))
      : el('p', { class: 'help', text: 'No shelves or bins inside this one.' }),

    el('button', {
      class: 'btn btn-block',
      onclick: () => placeForm({ parentId: place.id, onDone: () => refresh() }),
    }, [icon(ICONS.plus, 20), el('span', { text: 'Add a place inside' })]),

    el('div', { class: 'section-title', text: 'Label' }),
    el('div', { class: 'card qr-card' }, [
      qrElement(locationRepo.url(place), { size: 180 }),
      el('p', { class: 'help', text: 'Stick this on the bin. Scanning it with any '
        + 'camera opens this page.' }),
      el('a', { class: 'btn btn-block', href: `#/labels?only=${place.qr_slug}`, text: 'Print this label' }),
    ]),
  ]);
}

function breadcrumb(ancestors) {
  const parts = [];
  ancestors.forEach((a, i) => {
    if (i) parts.push(el('span', { class: 'crumb-sep', text: '›' }));
    parts.push(el('a', { class: 'crumb', href: `#/l/${a.qr_slug}`, text: a.name }));
  });
  return el('nav', { class: 'crumbs' }, parts);
}

function itemRow(item) {
  return el('a', { class: 'row', href: `#/item/${item.id}` }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: item.name }),
      el('div', { class: 'row-sub', text: `${item.quantity} ${item.unit || ''}`.trim() }),
    ]),
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}

function childRow(child) {
  return el('a', { class: 'row', href: `#/l/${child.qr_slug}` }, [
    el('span', { class: 'row-icon' }, [icon(ICONS.pin, 20)]),
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: child.name }),
      el('div', { class: 'row-sub', text: KIND_LABEL[child.kind] ?? 'Place' }),
    ]),
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}

function options(place) {
  const act = fn => () => { close(); fn(); };

  sheet({
    title: place.name,
    body: el('div', { class: 'list' }, [
      el('button', { class: 'row', onclick: act(() => placeForm({ location: place, onDone: () => refresh() })) },
        [el('div', { class: 'row-main' }, [el('div', { class: 'row-title', text: 'Rename or change type' })])]),
      el('button', { class: 'row', onclick: act(() => movePicker({ location: place, onDone: () => refresh() })) },
        [el('div', { class: 'row-main' }, [el('div', { class: 'row-title', text: 'Move somewhere else' })])]),
      el('button', { class: 'row', onclick: act(() => go(`/labels?only=${place.qr_slug}`)) },
        [el('div', { class: 'row-main' }, [el('div', { class: 'row-title', text: 'Print label' })])]),
      el('button', { class: 'row', onclick: act(() => remove(place)) },
        [el('div', { class: 'row-main' }, [el('div', { class: 'row-title danger', text: 'Delete this place' })])]),
    ]),
  });
}

async function remove(place) {
  const ok = await confirmSheet({
    title: `Delete ${place.name}?`,
    message: 'It disappears from every phone. Only works if it is empty.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;

  try {
    await locationRepo.remove(place.id);
    toast(`Deleted ${place.name}`);
    go('/locations', { replace: true });
  } catch (err) {
    errorToast(err.message);
  }
}
