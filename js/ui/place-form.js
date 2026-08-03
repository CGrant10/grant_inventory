// Add / edit a place. One sheet, used from the tree screen and from inside a
// place, so the two can never drift.

import { el } from './dom.js';
import { sheet, close } from './sheet.js';
import { toast, errorToast } from './toast.js';
import { LOCATION_KINDS } from '../core/model.js';
import { locationRepo } from '../data/locations.js';

/**
 * @param {object}  opts
 * @param {object=} opts.location  existing place to edit; omit to create
 * @param {string=} opts.parentId  parent for a new place
 * @param {function=} opts.onDone  called with the saved row
 */
export function placeForm({ location = null, parentId = null, onDone } = {}) {
  const editing = Boolean(location);

  const nameField = el('input', {
    class: 'field',
    type: 'text',
    value: location?.name ?? '',
    placeholder: 'Pantry, Shelf 2, Garage bin…',
    autocapitalize: 'words',
  });

  const notesField = el('textarea', {
    class: 'field',
    rows: 2,
    placeholder: 'Notes (optional)',
  });
  notesField.value = location?.notes ?? '';

  let kind = location?.kind ?? 'shelf';
  const kindRow = el('div', { class: 'chip-row' },
    LOCATION_KINDS.map(k => {
      const chip = el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(k.id === kind),
        text: k.label,
        onclick: () => {
          kind = k.id;
          for (const other of kindRow.children) {
            other.setAttribute('aria-pressed', String(other === chip));
          }
        },
      });
      return chip;
    }));

  const save = async () => {
    const name = nameField.value.trim();
    if (!name) return errorToast('Give the place a name.');
    try {
      const saved = editing
        ? await locationRepo.update(location.id, { name, kind, notes: notesField.value.trim() || null })
        : await locationRepo.create({ name, kind, parent_id: parentId, notes: notesField.value.trim() || null });
      close();
      toast(editing ? 'Saved' : `Added ${name}`);
      onDone?.(saved);
    } catch (err) {
      errorToast(err.message);
    }
  };

  nameField.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

  sheet({
    title: editing ? 'Edit place' : 'New place',
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: 'Name' }),
      nameField,
      el('label', { class: 'field-label', text: 'What kind of place?' }),
      kindRow,
      notesField,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary btn-block', text: editing ? 'Save' : 'Add place', onclick: save }),
    ],
  });
}

/** Picker for "move this place into…". Excludes the subtree being moved. */
export async function movePicker({ location, onDone }) {
  const [flat, forbidden] = await Promise.all([
    locationRepo.flatTree(),
    locationRepo.subtree(location.id),
  ]);
  const blocked = new Set([location.id, ...forbidden.map(l => l.id)]);

  const choose = async parentId => {
    try {
      await locationRepo.move(location.id, parentId);
      close();
      toast('Moved');
      onDone?.();
    } catch (err) {
      errorToast(err.message);
    }
  };

  const rows = [
    el('button', {
      class: 'row',
      onclick: () => choose(null),
    }, [el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: 'Top level' }),
      el('div', { class: 'row-sub', text: 'Not inside anything' }),
    ])]),
    ...flat.filter(l => !blocked.has(l.id)).map(l =>
      el('button', { class: 'row', onclick: () => choose(l.id) }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title', text: `${'  '.repeat(l.depth)}${l.name}` }),
        ]),
      ])),
  ];

  sheet({
    title: `Move ${location.name} into…`,
    body: el('div', { class: 'list' }, rows),
    actions: [el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() })],
  });
}
