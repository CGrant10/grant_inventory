// Record a purchase: what, when, how much, and how long it is covered for.
//
// Short by default. Standing in a kitchen with a receipt, the only fields anyone
// will fill in are the name and the price; serial numbers and model numbers hide
// under "More" until the day the thing breaks and they suddenly matter.

import { el } from './dom.js';
import { sheet, close } from './sheet.js';
import { toast, errorToast } from './toast.js';
import { WARRANTY_PRESETS, today } from '../core/model.js';
import { purchaseRepo, warrantyEnd } from '../data/purchases.js';
import * as idb from '../core/idb.js';

/**
 * @param {object=} opts.purchase  edit this one
 * @param {object=} opts.item      seed name and link from an item
 */
export async function purchaseForm({ purchase = null, item = null, onDone } = {}) {
  const editing = Boolean(purchase);
  const items = (await idb.all('items'))
    .filter(i => !i.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name));

  const name = el('input', {
    class: 'field', type: 'text', autocapitalize: 'sentences',
    value: purchase?.name ?? item?.name ?? '',
    placeholder: 'Dishwasher, deck stain, printer ink…',
  });

  const vendor = el('input', {
    class: 'field', type: 'text', autocapitalize: 'words',
    value: purchase?.vendor ?? '',
    placeholder: 'Where from? (Menards, Amazon…)',
  });

  const purchasedOn = el('input', {
    class: 'field', type: 'date',
    value: purchase?.purchased_on ?? today(),
  });

  const price = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: '0.01',
    value: purchase?.price ?? '',
    placeholder: 'Total paid',
  });

  const quantity = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any',
    value: purchase?.quantity ?? 1,
  });

  const linked = select(
    [['', 'Not linked to anything you stock'], ...items.map(i => [i.id, i.name])],
    purchase?.item_id ?? item?.id ?? '');

  // The preset writes an end date into the date field; the date field stays
  // editable so an odd term ("18 months", "expires when we sell the house") is
  // still expressible without a preset for it.
  const warrantyUntil = el('input', {
    class: 'field', type: 'date', value: purchase?.warranty_until ?? '',
  });

  const warrantyPreset = select(
    [['', 'Choose a term…'], ...WARRANTY_PRESETS.map((w, i) => [String(i), w.label])], '');

  warrantyPreset.addEventListener('change', () => {
    const preset = WARRANTY_PRESETS[Number(warrantyPreset.value)];
    if (!preset) return;
    warrantyUntil.value = preset.months
      ? warrantyEnd(purchasedOn.value || today(), preset.months) ?? ''
      : '';
  });

  const serial = el('input', {
    class: 'field', type: 'text', value: purchase?.serial_number ?? '',
    placeholder: 'Serial number', autocapitalize: 'characters',
  });

  const model = el('input', {
    class: 'field', type: 'text', value: purchase?.model_number ?? '',
    placeholder: 'Model number', autocapitalize: 'characters',
  });

  const notes = el('textarea', { class: 'field', rows: 2, placeholder: 'Notes (optional)' });
  notes.value = purchase?.notes ?? '';

  const more = el('div', { class: 'stack-sm', hidden: true }, [
    el('label', { class: 'field-label', text: 'Attached to' }), linked,
    el('label', { class: 'field-label', text: 'How many' }), quantity,
    el('label', { class: 'field-label', text: 'Serial and model' }), serial, model,
    notes,
  ]);

  const moreToggle = el('button', {
    class: 'btn btn-ghost btn-block', type: 'button', text: 'More details',
    onclick: () => {
      more.hidden = !more.hidden;
      moreToggle.textContent = more.hidden ? 'More details' : 'Fewer details';
    },
  });

  const save = async () => {
    const trimmed = name.value.trim();
    if (!trimmed) return errorToast('Say what was bought.');

    const fields = {
      name: trimmed,
      item_id: linked.value || null,
      vendor: vendor.value,
      purchased_on: purchasedOn.value || null,
      price: price.value === '' ? null : Number(price.value),
      quantity: quantity.value === '' ? 1 : Number(quantity.value),
      warranty_until: warrantyUntil.value || null,
      serial_number: serial.value,
      model_number: model.value,
      notes: notes.value,
    };

    try {
      const saved = editing
        ? await purchaseRepo.update(purchase.id, fields)
        : await purchaseRepo.create(fields);
      close();
      toast(editing ? 'Saved' : `Recorded ${trimmed}`);
      onDone?.(saved);
    } catch (err) {
      errorToast(err.message);
    }
  };

  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

  sheet({
    title: editing ? 'Edit purchase' : 'Record a purchase',
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: 'What was bought?' }),
      name,
      vendor,
      el('div', { class: 'field-pair' }, [purchasedOn, price]),
      el('label', { class: 'field-label', text: 'Warranty' }),
      el('div', { class: 'field-pair' }, [warrantyPreset, warrantyUntil]),
      moreToggle,
      more,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn btn-primary btn-block',
        text: editing ? 'Save' : 'Record it',
        onclick: save,
      }),
    ],
  });
}

function select(options, value) {
  const node = el('select', { class: 'field' },
    options.map(([v, label]) => el('option', { value: v, text: label })));
  node.value = value ?? '';
  return node;
}
