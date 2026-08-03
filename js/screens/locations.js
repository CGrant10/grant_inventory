// The places tree. Every place in the house at a glance, indented, with what's
// inside it — the answer to "where do I put this" and "where did that go".

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { locationRepo } from '../data/locations.js';
import { placeForm } from '../ui/place-form.js';
import * as idb from '../core/idb.js';
import { LOCATION_KINDS } from '../core/model.js';

const KIND_LABEL = Object.fromEntries(LOCATION_KINDS.map(k => [k.id, k.label]));

export default async function locations() {
  const [flat, items] = await Promise.all([
    locationRepo.flatTree(),
    idb.all('items'),
  ]);

  const directCount = new Map();
  for (const item of items) {
    directCount.set(item.location_id, (directCount.get(item.location_id) ?? 0) + 1);
  }

  const addButton = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => placeForm({ parentId: null }),
  }, [icon(ICONS.plus, 20), el('span', { text: 'Add a place' })]);

  if (!flat.length) {
    return el('div', { class: 'stack' }, [
      empty({
        glyph: ICONS.pin,
        title: 'No places yet',
        body: 'Start with the big ones — Kitchen, Garage, Basement — then add the '
            + 'shelves and bins inside them.',
      }),
      addButton,
    ]);
  }

  return el('div', { class: 'stack' }, [
    el('div', { class: 'list' }, flat.map(node => row(node, directCount))),
    addButton,
    el('a', { class: 'btn btn-block', href: '#/labels' }, [
      icon(ICONS.box, 20), el('span', { text: 'Print QR labels' }),
    ]),
  ]);
}

function row(node, directCount) {
  const count = directCount.get(node.id) ?? 0;
  const sub = [KIND_LABEL[node.kind] ?? 'Place', count ? `${count} item${count === 1 ? '' : 's'}` : null]
    .filter(Boolean).join(' · ');

  return el('a', {
    class: 'row place-row',
    href: `#/l/${node.qr_slug}`,
    style: `--depth:${node.depth}`,
  }, [
    el('span', { class: 'row-icon' }, [icon(ICONS.pin, 20)]),
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: node.name }),
      el('div', { class: 'row-sub', text: sub }),
    ]),
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}
