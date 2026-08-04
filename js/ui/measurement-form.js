// Add / edit a measurement. The dimension rows are the point, so they get the
// space: a preset set appears the moment you pick what kind of thing it is.

import { el, icon, ICONS } from './dom.js';
import { sheet, close } from './sheet.js';
import { toast, errorToast } from './toast.js';
import { SUBJECT_KINDS, DIM_PRESETS, MEASURE_UNITS } from '../core/model.js';
import { measurementRepo } from '../data/measurements.js';
import { locationRepo } from '../data/locations.js';

export async function measurementForm({ measurement = null, onDone } = {}) {
  const editing = Boolean(measurement);
  const places = await locationRepo.flatTree();
  const existing = editing ? await measurementRepo.dimensions(measurement.id) : [];

  let kind = measurement?.subject_kind ?? 'cabinet';
  let unit = existing[0]?.unit ?? 'in';

  const name = el('input', {
    class: 'field', type: 'text', value: measurement?.name ?? '',
    placeholder: 'Kitchen window over the sink', autocapitalize: 'sentences',
  });

  const place = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'Anywhere in particular?' }),
    ...places.map(p => el('option', { value: p.id, text: `${'— '.repeat(p.depth)}${p.name}` })),
  ]);
  place.value = measurement?.location_id ?? '';

  const notes = el('textarea', { class: 'field', rows: 2, placeholder: 'Notes (optional)' });
  notes.value = measurement?.notes ?? '';

  const rows = el('div', { class: 'dim-rows' });

  function addRow(label = '', value = '') {
    const labelField = el('input', { class: 'field', type: 'text', value: label, placeholder: 'Width' });
    const valueField = el('input', {
      class: 'field', type: 'number', inputmode: 'decimal', step: 'any', value: String(value),
      placeholder: '0',
    });
    const row = el('div', { class: 'dim-row' }, [
      labelField,
      valueField,
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Remove',
        onclick: () => row.remove(),
      }, [icon('<path d="M6 6l12 12M18 6L6 18"/>', 20)]),
    ]);
    row.read = () => ({ label: labelField.value.trim(), value: valueField.value });
    rows.append(row);
    return row;
  }

  function loadPreset() {
    rows.replaceChildren();
    for (const label of DIM_PRESETS[kind] ?? DIM_PRESETS.other) addRow(label, '');
  }

  if (editing && existing.length) {
    for (const d of existing) addRow(d.label, d.value);
  } else {
    loadPreset();
  }

  const kindRow = el('div', { class: 'chip-row' }, SUBJECT_KINDS.map(k =>
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(k.id === kind), text: k.label,
      onclick: e => {
        kind = k.id;
        for (const chip of e.currentTarget.parentElement.children) {
          chip.setAttribute('aria-pressed', String(chip === e.currentTarget));
        }
        // Only reshuffle the rows when nothing has been typed yet — nobody wants
        // their numbers thrown away because they corrected the category.
        const blank = [...rows.children].every(r => r.read().value === '');
        if (blank) loadPreset();
      },
    })));

  const unitRow = el('div', { class: 'chip-row' }, MEASURE_UNITS.map(u =>
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(u === unit), text: u,
      onclick: e => {
        unit = u;
        for (const chip of e.currentTarget.parentElement.children) {
          chip.setAttribute('aria-pressed', String(chip === e.currentTarget));
        }
      },
    })));

  const save = async () => {
    const trimmed = name.value.trim();
    if (!trimmed) return errorToast('Give it a name you will recognise later.');

    const entered = [...rows.children]
      .map(r => r.read())
      .filter(d => d.label && d.value !== '' && Number.isFinite(Number(d.value)))
      .map(d => ({ ...d, unit }));

    try {
      if (editing) {
        await measurementRepo.update(measurement.id, {
          name: trimmed, subject_kind: kind, location_id: place.value || null,
          notes: notes.value.trim() || null,
        });
        // Replace the set rather than diffing it: a handful of rows, and the
        // result is always exactly what is on screen.
        for (const d of existing) await measurementRepo.removeDimension(d.id);
        let order = 0;
        for (const d of entered) await measurementRepo.addDimension(measurement.id, { ...d, sort_order: order++ });
      } else {
        await measurementRepo.create({
          name: trimmed, subject_kind: kind, location_id: place.value || null,
          notes: notes.value.trim() || null, dimensions: entered,
        });
      }
      close();
      toast(editing ? 'Saved' : `Measured ${trimmed}`);
      onDone?.();
    } catch (err) {
      errorToast(err.message);
    }
  };

  sheet({
    title: editing ? 'Edit measurement' : 'New measurement',
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: 'What did you measure?' }),
      name,
      kindRow,
      el('label', { class: 'field-label', text: 'Units' }),
      unitRow,
      el('label', { class: 'field-label', text: 'Dimensions' }),
      rows,
      el('button', {
        class: 'btn btn-ghost btn-block', type: 'button',
        text: '+ Another dimension',
        onclick: () => addRow(),
      }),
      el('label', { class: 'field-label', text: 'Where is it?' }),
      place,
      notes,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary btn-block', text: editing ? 'Save' : 'Save measurement', onclick: save }),
    ],
  });
}
