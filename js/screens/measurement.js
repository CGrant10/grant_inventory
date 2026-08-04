// One measurement. Numbers big enough to read at arm's length in a shop.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { measurementRepo, fmtNumber } from '../data/measurements.js';
import { measurementForm } from '../ui/measurement-form.js';
import { photoStrip } from '../ui/photo.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { go, refresh } from '../core/router.js';
import { SUBJECT_KINDS } from '../core/model.js';
import * as idb from '../core/idb.js';

const KIND_LABEL = Object.fromEntries(SUBJECT_KINDS.map(k => [k.id, k.label]));

export default async function measurement({ id }) {
  const row = await idb.get('measurements', id);
  if (!row || row.deleted_at) {
    return empty({
      glyph: ICONS.warn,
      title: 'That measurement is gone',
      body: 'It was deleted, or this phone has not synced yet.',
      action: el('a', { class: 'btn', href: '#/measurements', text: 'All measurements' }),
    });
  }

  const [dims, place] = await Promise.all([
    measurementRepo.dimensions(row.id),
    row.location_id ? idb.get('locations', row.location_id) : null,
  ]);

  return el('div', { class: 'stack' }, [
    el('div', { class: 'place-head' }, [
      el('div', {}, [
        el('h2', { class: 'place-name', text: row.name }),
        el('div', { class: 'row-sub', text: KIND_LABEL[row.subject_kind] ?? 'Other' }),
      ]),
      el('button', {
        class: 'icon-btn', 'aria-label': 'Edit',
        onclick: () => measurementForm({ measurement: row, onDone: refresh }),
      }, [icon('<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>', 22)]),
    ]),

    dims.length
      ? el('div', { class: 'dim-grid selectable' }, dims.map(d => el('div', { class: 'dim-cell' }, [
          el('div', { class: 'dim-label', text: d.label }),
          el('div', { class: 'dim-value', text: `${fmtNumber(d.value)}` }),
          el('div', { class: 'dim-unit', text: d.unit }),
        ])))
      : el('p', { class: 'help', text: 'No dimensions recorded.' }),

    place
      ? el('div', { class: 'list' }, [
          el('a', { class: 'row', href: `#/l/${place.qr_slug}` }, [
            el('span', { class: 'row-icon' }, [icon(ICONS.pin, 20)]),
            el('div', { class: 'row-main' }, [
              el('div', { class: 'row-title', text: place.name }),
              el('div', { class: 'row-sub', text: 'Where this is' }),
            ]),
            el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
          ]),
        ])
      : null,

    row.notes ? el('p', { class: 'help selectable', text: row.notes }) : null,

    // What was measured, and from where — three numbers rarely say which window.
    photoStrip('measurement', row.id, { onChange: refresh }),

    el('button', {
      class: 'btn btn-danger btn-block',
      text: 'Delete measurement',
      onclick: async () => {
        const ok = await confirmSheet({
          title: `Delete ${row.name}?`,
          message: 'The dimensions go with it, on every phone.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        await measurementRepo.remove(row.id);
        toast('Deleted');
        go('/measurements', { replace: true });
      },
    }),
  ]);
}
