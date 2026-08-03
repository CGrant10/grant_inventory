// Printable QR labels.
//
// Rendered as an ordinary screen with print styles rather than a popup window:
// popups are blocked on phones, and this way what you see is what prints.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { qrElement } from '../ui/qr.js';
import { locationRepo } from '../data/locations.js';
import { query } from '../core/router.js';
import { LOCATION_KINDS } from '../core/model.js';

const KIND_LABEL = Object.fromEntries(LOCATION_KINDS.map(k => [k.id, k.label]));

export default async function labels() {
  const only = query().get('only');
  const flat = await locationRepo.flatTree();
  const chosen = only ? flat.filter(l => l.qr_slug === only) : flat;

  if (!chosen.length) {
    return empty({
      glyph: ICONS.pin,
      title: only ? 'That place is gone' : 'Nothing to label yet',
      body: 'Add some places first, then come back and print labels for them.',
      action: el('a', { class: 'btn', href: '#/locations', text: 'Places' }),
    });
  }

  // Full paths make a label meaningful once it is off the screen and on a bin.
  const paths = new Map(
    await Promise.all(chosen.map(async l => [l.id, await locationRepo.path(l.id)])));

  return el('div', { class: 'stack' }, [
    el('div', { class: 'no-print stack-sm' }, [
      el('p', { class: 'help', text:
        `${chosen.length} label${chosen.length === 1 ? '' : 's'}. Print, cut along the `
        + 'lines, and stick one on each bin. Scanning a label with any phone camera '
        + 'opens that place.' }),
      el('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => window.print(),
      }, [icon(ICONS.box, 20), el('span', { text: 'Print' })]),
      only ? el('a', { class: 'btn btn-block', href: '#/labels', text: 'Print all places instead' }) : null,
    ]),

    el('div', { class: 'label-sheet' }, chosen.map(place => label(place, paths.get(place.id)))),
  ]);
}

function label(place, path) {
  const parent = path.includes(' › ') ? path.slice(0, path.lastIndexOf(' › ')) : '';
  return el('div', { class: 'label' }, [
    qrElement(locationRepo.url(place), { size: 132, ecc: 'Q', className: 'label-qr' }),
    el('div', { class: 'label-text' }, [
      el('div', { class: 'label-name', text: place.name }),
      parent ? el('div', { class: 'label-path', text: parent }) : null,
      el('div', { class: 'label-kind', text: KIND_LABEL[place.kind] ?? 'Place' }),
    ]),
  ]);
}
