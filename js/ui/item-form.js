// Add / edit an item. Deliberately short: a name and a place is enough to save,
// everything else is optional and tucked under "More".

import { el, icon, ICONS } from './dom.js';
import { sheet, close } from './sheet.js';
import { toast, errorToast } from './toast.js';
import { UNITS } from '../core/model.js';
import { itemRepo } from '../data/items.js';
import { locationRepo } from '../data/locations.js';
import { categoryRepo } from '../data/categories.js';

/**
 * @param {object=} opts.prefill  seed a new item from a scan: { name, unit, product_id }
 */
export async function itemForm({ item = null, locationId = null, prefill = null, onDone } = {}) {
  const editing = Boolean(item);
  const [places, categories] = await Promise.all([
    locationRepo.flatTree(),
    categoryRepo.list(),
  ]);

  const name = el('input', {
    class: 'field', type: 'text', value: item?.name ?? prefill?.name ?? '',
    placeholder: 'Black beans, paper towels…', autocapitalize: 'sentences',
  });

  const qty = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any',
    value: editing ? '' : '1', placeholder: 'Quantity',
  });

  const unit = select(UNITS.map(u => [u, u]), item?.unit ?? prefill?.unit ?? 'ea');

  const place = select(
    [['', 'No place yet'], ...places.map(p => [p.id, `${'— '.repeat(p.depth)}${p.name}`])],
    item?.location_id ?? locationId ?? '');

  const category = select(
    [['', 'No category'], ...categories.map(c => [c.id, c.name])],
    item?.category_id ?? '');

  const minQty = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any',
    value: item?.min_quantity ?? '', placeholder: 'Keep at least this many',
  });

  const expires = el('input', {
    class: 'field', type: 'date', value: item?.expires_on ?? '',
  });

  const notes = el('textarea', { class: 'field', rows: 2, placeholder: 'Notes (optional)' });
  notes.value = item?.notes ?? '';

  const more = el('div', { class: 'stack-sm', hidden: true }, [
    el('label', { class: 'field-label', text: 'Category' }), category,
    el('label', { class: 'field-label', text: 'Keep at least' }), minQty,
    el('label', { class: 'field-label', text: 'Expires' }), expires,
    notes,
  ]);

  const moreToggle = el('button', {
    class: 'btn btn-ghost btn-block', type: 'button',
    text: 'More details',
    onclick: () => {
      more.hidden = !more.hidden;
      moreToggle.textContent = more.hidden ? 'More details' : 'Fewer details';
    },
  });

  // "Added 3 · Coffee, Beans, Rice" — the receipt for a run of quick adds, so
  // the sheet staying open still feels like something happened each time.
  const added = [];
  const tally = el('div', { class: 'form-tally', hidden: true });

  const showTally = () => {
    tally.hidden = !added.length;
    const shown = added.slice(-3).reverse().join(', ');
    tally.textContent = `Added ${added.length} · ${shown}${added.length > 3 ? '…' : ''}`;
  };

  /**
   * @param {boolean} again  keep the sheet open for the next one.
   *
   * Filling a bin is twenty items in the same place, and closing the sheet after
   * each one makes that twenty round trips through the list behind it. Staying
   * open keeps the place, the unit and the category — the parts that do not
   * change — and clears only the name.
   */
  const save = async (again = false) => {
    const trimmed = name.value.trim();
    if (!trimmed) return errorToast('Give the item a name.');

    const fields = {
      name: trimmed,
      unit: unit.value,
      location_id: place.value || null,
      category_id: category.value || null,
      min_quantity: minQty.value === '' ? null : Number(minQty.value),
      expires_on: expires.value || null,
      notes: notes.value.trim() || null,
    };

    try {
      const saved = editing
        ? await itemRepo.update(item.id, fields)
        : await itemRepo.create({
            ...fields,
            // Keeps the barcode attached, so the next scan finds this item.
            product_id: prefill?.product_id ?? null,
            quantity: qty.value === '' ? 0 : Number(qty.value),
          });

      if (again) {
        added.push(trimmed);
        showTally();
        name.value = '';
        qty.value = '1';
        // The barcode belongs to the item that was just saved, not to the next
        // one typed by hand.
        prefill = null;
        name.focus({ preventScroll: true });
      } else {
        close();
        toast(editing ? 'Saved' : `Added ${trimmed}`);
      }
      onDone?.(saved);
    } catch (err) {
      errorToast(err.message);
    }
  };

  // Enter is the fast path, so it does whatever the run is doing: on a new item
  // it saves and stays, because nobody types one name and reaches for the mouse.
  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(!editing); });

  sheet({
    title: editing ? 'Edit item' : 'New item',
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: 'What is it?' }),
      name,
      el('div', { class: 'field-pair' }, [
        editing ? null : qty,
        unit,
      ]),
      el('label', { class: 'field-label', text: 'Where does it live?' }),
      place,
      moreToggle,
      more,
      tally,
    ]),
    actions: [
      editing
        ? el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() })
        : el('div', { class: 'btn-pair' }, [
            el('button', { class: 'btn', text: 'Cancel', onclick: () => close() }),
            el('button', { class: 'btn', text: 'Save & another', onclick: () => save(true) }),
          ]),
      el('button', {
        class: 'btn btn-primary btn-block',
        text: editing ? 'Save' : 'Add item',
        onclick: () => save(false),
      }),
    ],
  });
}

/** Picker for "move this item to…". */
export async function moveItem({ item, onDone }) {
  const places = await locationRepo.flatTree();

  const choose = async id => {
    try {
      await itemRepo.move(item.id, id);
      close();
      toast(id ? 'Moved' : 'Removed from its place');
      onDone?.();
    } catch (err) {
      errorToast(err.message);
    }
  };

  const rows = [
    row('No place', 'Not stored anywhere in particular', () => choose(null)),
    ...places.map(p => row(`${'  '.repeat(p.depth)}${p.name}`, null, () => choose(p.id),
                           p.id === item.location_id)),
  ];

  sheet({
    title: `Move ${item.name} to…`,
    body: el('div', { class: 'list' }, rows),
    actions: [el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() })],
  });
}

function row(title, sub, onclick, current = false) {
  return el('button', { class: 'row', onclick }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: title }),
      sub ? el('div', { class: 'row-sub', text: sub }) : null,
    ]),
    current ? el('span', { class: 'badge badge-ok', text: 'Here now' }) : null,
  ]);
}

function select(options, value) {
  const node = el('select', { class: 'field' },
    options.map(([v, label]) => el('option', { value: v, text: label })));
  node.value = value ?? '';
  return node;
}
