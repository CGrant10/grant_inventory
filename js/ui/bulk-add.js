// Add many items at once, from a typed or dictated list.
//
// The one-at-a-time form is right for the thing you just bought. It is the wrong
// shape for the first pass through a house, where a single tote holds thirty
// things and every one of them needs the same place. Here the place is chosen
// once and the names are a list — which is also the shape a phone's dictation
// button produces, and the shape of a list already written on paper.
//
// Nothing is created until the whole list parses. A half-imported tote is worse
// than a rejected one, because the only way to find out what landed is to read
// the list back item by item.

import { el } from './dom.js';
import { sheet, close } from './sheet.js';
import { toast, errorToast } from './toast.js';
import { UNITS } from '../core/model.js';
import { itemRepo } from '../data/items.js';
import { locationRepo } from '../data/locations.js';

const UNIT_BY_LOWER = new Map(UNITS.map(u => [u.toLowerCase(), u]));

/**
 * One line → one item. `Name`, `Name, 3`, `Name, 3, can`, or `Name, can`.
 *
 * Tabs count as separators too, so a column pasted out of a spreadsheet works
 * without being reformatted first.
 *
 * @returns {{rows: object[], errors: {line: number, text: string, message: string}[]}}
 */
export function parseBulkLines(text) {
  const rows = [];
  const errors = [];

  String(text ?? '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    // A blank line is a paragraph break, and '#' is how anyone writes a heading
    // in a plain list. Neither is a mistake worth complaining about.
    if (!line || line.startsWith('#')) return;

    const fail = message => errors.push({ line: index + 1, text: line, message });
    const parts = line.split(/[\t,]/).map(p => p.trim()).filter((p, i) => p !== '' || i === 0);

    const name = parts[0];
    if (!name) return fail('No name on this line.');

    let quantity = 1;
    let unit = 'ea';

    for (const token of parts.slice(1)) {
      if (isNumber(token)) {
        const value = Number(token);
        if (value < 0) return fail(`"${token}" is a negative quantity.`);
        quantity = value;
        continue;
      }
      const known = UNIT_BY_LOWER.get(token.toLowerCase());
      if (!known) return fail(`"${token}" is not a quantity or a unit.`);
      unit = known;
    }

    rows.push({ name, quantity, unit });
  });

  return { rows, errors };
}

function isNumber(token) {
  return token !== '' && Number.isFinite(Number(token));
}

/**
 * @param {string=} opts.locationId  pre-selected place — set when opened from a bin.
 */
export async function bulkAddForm({ locationId = null, onDone } = {}) {
  const places = await locationRepo.flatTree();

  const place = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'No place yet' }),
    ...places.map(p => el('option', { value: p.id, text: `${'— '.repeat(p.depth)}${p.name}` })),
  ]);
  place.value = locationId ?? '';

  const list = el('textarea', {
    class: 'field bulk-list', rows: 8, autocapitalize: 'sentences', autocomplete: 'off',
    placeholder: 'Paper towels, 6, roll\nBlack beans, 4, can\nDuct tape\nFurnace filters, 2',
  });

  const summary = el('p', { class: 'help' });
  const problems = el('div', { class: 'bulk-problems', hidden: true });
  const submit = el('button', { class: 'btn btn-primary btn-block', text: 'Add items', disabled: true });

  let parsed = { rows: [], errors: [] };

  const review = () => {
    parsed = parseBulkLines(list.value);
    const { rows, errors } = parsed;

    summary.textContent = errors.length
      ? `${errors.length} line${errors.length === 1 ? ' needs' : 's need'} fixing first.`
      : rows.length
        ? `${rows.length} item${rows.length === 1 ? '' : 's'} ready.`
        : 'One item per line. A quantity and a unit are optional.';

    problems.hidden = !errors.length;
    problems.replaceChildren(...errors.slice(0, 6).map(e =>
      el('div', { class: 'bulk-problem' }, [
        el('span', { class: 'bulk-line', text: `Line ${e.line}` }),
        el('span', { text: `${e.text} — ${e.message}` }),
      ])));

    // Nothing goes in until every line is understood, so the button says so.
    submit.disabled = Boolean(errors.length) || !rows.length;
    submit.textContent = rows.length && !errors.length
      ? `Add ${rows.length} item${rows.length === 1 ? '' : 's'}`
      : 'Add items';
  };

  list.addEventListener('input', review);
  review();

  submit.onclick = async () => {
    const { rows, errors } = parseBulkLines(list.value);
    if (errors.length || !rows.length) return review();

    submit.disabled = true;
    submit.textContent = 'Adding…';
    const location_id = place.value || null;

    try {
      for (const row of rows) {
        await itemRepo.create({ ...row, location_id });
      }
      close();
      toast(`Added ${rows.length} item${rows.length === 1 ? '' : 's'}`);
      onDone?.(rows.length);
    } catch (err) {
      // Some of them may already be in. Say so rather than implying none are.
      errorToast(`Stopped partway: ${err.message}`);
      onDone?.(0);
      review();
    }
  };

  sheet({
    title: 'Add several items',
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: 'Where do they live?' }),
      place,
      el('label', { class: 'field-label', text: 'One per line' }),
      list,
      summary,
      problems,
      el('p', { class: 'help', text:
        'Add a quantity and a unit after commas — “Black beans, 4, can”. '
        + 'Dictating with the keyboard’s microphone works too.' }),
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      submit,
    ],
  });
}
