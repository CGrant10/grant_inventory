// Search across everything at once.
//
// Per-screen search only helps if you already know which screen. "Where are the
// spare furnace filters" should not require deciding whether that is an item, a
// place, or a maintenance job first.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { fmtQty, isLow } from '../data/items.js';
import { summarise } from '../data/measurements.js';
import { dueLabel } from '../data/maintenance.js';
import { query, go } from '../core/router.js';
import * as idb from '../core/idb.js';

export default async function search() {
  const [items, locations, measurements, dims, projects, tasks, shopping] = await Promise.all([
    idb.all('items'),
    idb.all('locations'),
    idb.all('measurements'),
    idb.all('measurement_dims'),
    idb.all('projects'),
    idb.all('maintenance_tasks').catch(() => []),
    idb.all('shopping_items'),
  ]);

  const placeName = new Map(locations.map(l => [l.id, l.name]));
  const dimsByMeasurement = new Map();
  for (const d of dims) {
    if (!dimsByMeasurement.has(d.measurement_id)) dimsByMeasurement.set(d.measurement_id, []);
    dimsByMeasurement.get(d.measurement_id).push(d);
  }

  // One flat index. Small enough to rebuild on every visit, and rebuilding means
  // it can never be stale.
  const index = [
    ...items.map(i => ({
      group: 'Items',
      title: i.name,
      sub: [placeName.get(i.location_id), `${fmtQty(i.quantity)} ${i.unit || ''}`.trim()]
        .filter(Boolean).join(' · '),
      badge: isLow(i) ? { text: 'Low', tone: 'warn' } : null,
      href: `#/item/${i.id}`,
      hay: `${i.name} ${i.notes ?? ''} ${placeName.get(i.location_id) ?? ''}`,
      glyph: ICONS.box,
    })),
    ...locations.map(l => ({
      group: 'Places',
      title: l.name,
      sub: l.kind,
      href: `#/l/${l.qr_slug}`,
      hay: `${l.name} ${l.kind} ${l.notes ?? ''}`,
      glyph: ICONS.pin,
    })),
    ...measurements.map(m => ({
      group: 'Measurements',
      title: m.name,
      sub: summarise(dimsByMeasurement.get(m.id) ?? []),
      href: `#/measurement/${m.id}`,
      hay: `${m.name} ${m.subject_kind} ${m.notes ?? ''}`,
      glyph: ICONS.ruler,
    })),
    ...projects.map(p => ({
      group: 'Projects',
      title: p.title,
      sub: p.status,
      href: `#/project/${p.id}`,
      hay: `${p.title} ${p.description ?? ''} ${p.status}`,
      glyph: ICONS.hammer,
    })),
    ...tasks.map(t => ({
      group: 'Maintenance',
      title: t.name,
      sub: dueLabel(t),
      href: '#/maintenance',
      hay: `${t.name} ${t.notes ?? ''}`,
      glyph: ICONS.clock,
    })),
    ...shopping.filter(s => s.status !== 'purchased').map(s => ({
      group: 'Shopping list',
      title: s.name,
      sub: `${fmtQty(s.quantity)} ${s.unit || ''}`.trim(),
      href: '#/shopping',
      hay: s.name,
      glyph: ICONS.cart,
    })),
  ];

  const field = el('input', {
    class: 'field', type: 'search', placeholder: 'Search everything…',
    autocapitalize: 'none', autocomplete: 'off', autofocus: true,
  });
  field.value = query().get('q') ?? '';

  const results = el('div', { class: 'stack' });

  function render() {
    const q = field.value.trim().toLowerCase();
    if (!q) {
      results.replaceChildren(el('p', { class: 'help pad', text:
        `Searching ${index.length} things across items, places, measurements, `
        + 'projects, maintenance and the shopping list.' }));
      return;
    }

    const hits = index.filter(entry => entry.hay.toLowerCase().includes(q));
    if (!hits.length) {
      results.replaceChildren(empty({
        glyph: ICONS.search, title: 'Nothing found',
        body: `No item, place, measurement, project or job mentions “${field.value.trim()}”.`,
      }));
      return;
    }

    // Group, keeping the order the index was built in so the important things
    // (what you own, where it is) come before the peripheral.
    const groups = new Map();
    for (const hit of hits) {
      if (!groups.has(hit.group)) groups.set(hit.group, []);
      groups.get(hit.group).push(hit);
    }

    results.replaceChildren(...[...groups.entries()].map(([group, list]) => el('div', {}, [
      el('div', { class: 'section-title', text: `${group} (${list.length})` }),
      el('div', { class: 'list' }, list.slice(0, 20).map(resultRow)),
    ])));
  }

  field.addEventListener('input', render);
  render();
  queueMicrotask(() => field.focus());

  return el('div', { class: 'stack' }, [field, results]);
}

function resultRow(hit) {
  return el('a', { class: 'row', href: hit.href }, [
    el('span', { class: 'row-icon' }, [icon(hit.glyph, 20)]),
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: hit.title }),
      hit.sub ? el('div', { class: 'row-sub', text: hit.sub }) : null,
    ]),
    hit.badge ? el('span', { class: `badge badge-${hit.badge.tone}`, text: hit.badge.text }) : null,
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}
