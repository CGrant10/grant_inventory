// Measurements, searchable. The whole value is being able to find the number
// while standing in a shop, so search covers the name, the kind and the place.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { measurementRepo, summarise } from '../data/measurements.js';
import { measurementForm } from '../ui/measurement-form.js';
import { locationRepo } from '../data/locations.js';
import { SUBJECT_KINDS } from '../core/model.js';

const KIND_LABEL = Object.fromEntries(SUBJECT_KINDS.map(k => [k.id, k.label]));

export default async function measurements() {
  const [rows, places] = await Promise.all([
    measurementRepo.withDimensions(),
    locationRepo.flatTree(),
  ]);
  const placeName = new Map(places.map(p => [p.id, p.name]));

  const addButton = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => measurementForm({}),
  }, [icon(ICONS.plus, 20), el('span', { text: 'Measure something' })]);

  if (!rows.length) {
    return el('div', { class: 'stack' }, [
      empty({
        glyph: ICONS.ruler,
        title: 'No measurements yet',
        body: 'Window openings, cabinet gaps, the space the fridge has to fit in — '
            + 'the numbers you always end up driving home for.',
      }),
      addButton,
    ]);
  }

  const search = el('input', {
    class: 'field', type: 'search', placeholder: 'Search measurements…',
    autocapitalize: 'none', autocomplete: 'off',
  });
  const list = el('div', { class: 'list' });
  const count = el('div', { class: 'section-title' });

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = rows.filter(m => {
      if (!q) return true;
      const haystack = `${m.name} ${KIND_LABEL[m.subject_kind] ?? ''} ${placeName.get(m.location_id) ?? ''} ${m.notes ?? ''}`;
      return haystack.toLowerCase().includes(q);
    });
    count.textContent = `${shown.length} measurement${shown.length === 1 ? '' : 's'}`;
    list.replaceChildren(...(shown.length
      ? shown.map(m => row(m, placeName))
      : [el('p', { class: 'help pad', text: 'Nothing matches that.' })]));
  }

  search.addEventListener('input', render);
  render();

  return el('div', { class: 'stack' }, [search, count, list, addButton]);
}

function row(m, placeName) {
  const where = placeName.get(m.location_id);
  return el('a', { class: 'row', href: `#/measurement/${m.id}` }, [
    el('span', { class: 'row-icon' }, [icon(ICONS.ruler, 20)]),
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: m.name }),
      el('div', { class: 'row-sub', text:
        [summarise(m.dims), KIND_LABEL[m.subject_kind], where].filter(Boolean).join(' · ') }),
    ]),
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}
