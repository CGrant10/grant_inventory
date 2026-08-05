// Everything you own, searchable, with the quantity adjustable without leaving
// the list — the common case is "use one", not "open the item and study it".

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { itemRepo, isLow, expiryState } from '../data/items.js';
import { categoryRepo } from '../data/categories.js';
import { locationRepo } from '../data/locations.js';
import { itemForm } from '../ui/item-form.js';
import { bulkAddForm } from '../ui/bulk-add.js';
import { stepper } from '../ui/stepper.js';
import { query, go, refresh } from '../core/router.js';

// Which way the list is stacked. Not in the URL like the filters: it is a
// preference about reading rather than a place you navigated to, and it should
// still be true tomorrow.
const GROUP_KEY = 'gi.inventory.group';

export default async function inventory() {
  const [items, categories, places] = await Promise.all([
    itemRepo.all(),
    categoryRepo.map(),
    locationRepo.flatTree(),
  ]);

  const placeName = new Map(places.map(p => [p.id, p.name]));
  const placePath = pathLabels(places);
  const filter = query().get('filter') || 'all';
  let grouped = localStorage.getItem(GROUP_KEY) === 'place';

  const addButton = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => itemForm({ onDone: () => refresh() }),
  }, [icon(ICONS.plus, 20), el('span', { text: 'Add an item' })]);

  const bulkButton = el('button', {
    class: 'btn btn-block',
    onclick: () => bulkAddForm({ onDone: () => refresh() }),
  }, [icon(ICONS.plus, 20), el('span', { text: 'Add several at once' })]);

  // ?add=1 opens the form straight away, so "Add an item" from the dashboard is
  // one tap rather than a tap and a scroll. The parameter is stripped first, or
  // a back-tap would reopen the form every time.
  if (query().get('add')) {
    history.replaceState(null, '', location.pathname + location.search + '#/inventory');
    itemForm({});
  }

  if (!items.length) {
    return el('div', { class: 'stack' }, [
      empty({
        glyph: ICONS.box,
        title: 'Nothing tracked yet',
        body: 'Add the things you run out of first — coffee, paper towels, dog food. '
            + 'Those are the ones worth knowing about.',
      }),
      addButton,
      bulkButton,
    ]);
  }

  const search = el('input', {
    class: 'field', type: 'search', placeholder: 'Search items…',
    autocapitalize: 'none', autocomplete: 'off',
  });

  const body = el('div', { class: 'stack-sm' });
  const count = el('div', { class: 'section-title' });

  // A toggle, not a fourth filter — it changes the shape of the same list, so it
  // sits apart from the three chips that change which items are in it.
  const groupChip = chip('By place', grouped, () => {
    grouped = !grouped;
    localStorage.setItem(GROUP_KEY, grouped ? 'place' : 'name');
    groupChip.setAttribute('aria-pressed', String(grouped));
    render();
  });

  const filters = el('div', { class: 'chip-row' }, [
    chip('All', filter === 'all', () => go('/inventory')),
    chip('Running low', filter === 'low', () => go('/inventory?filter=low')),
    chip('Expiring', filter === 'expiring', () => go('/inventory?filter=expiring')),
    el('span', { class: 'chip-spacer' }),
    groupChip,
  ]);

  function visible() {
    const q = search.value.trim().toLowerCase();
    return items
      .filter(i => {
        if (filter === 'low' && !isLow(i)) return false;
        if (filter === 'expiring' && !expiryState(i, 30)) return false;
        if (!q) return true;
        const category = categories.get(i.category_id)?.name ?? '';
        const place = placeName.get(i.location_id) ?? '';
        return `${i.name} ${category} ${place}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function render() {
    const rows = visible();
    count.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      body.replaceChildren(el('p', { class: 'help pad', text: 'Nothing matches that.' }));
      return;
    }

    const row = item => itemRow(item, categories, placeName, grouped);

    if (!grouped) {
      body.replaceChildren(el('div', { class: 'list' }, rows.map(row)));
      return;
    }

    body.replaceChildren(...groupByPlace(rows, places).map(({ id, items: group }) => el('section', {}, [
      el('div', { class: 'group-head' }, [
        id
          ? el('a', { class: 'group-name', href: `#/l/${placeSlug.get(id)}`, text: placePath.get(id) })
          : el('span', { class: 'group-name', text: 'No place set' }),
        el('span', { class: 'group-count', text: String(group.length) }),
      ]),
      el('div', { class: 'list' }, group.map(row)),
    ])));
  }

  const placeSlug = new Map(places.map(p => [p.id, p.qr_slug]));

  search.addEventListener('input', render);
  render();

  return el('div', { class: 'stack' }, [search, filters, count, body, addButton, bulkButton]);
}

/**
 * Items bucketed by place, in the order the places appear in the tree — so the
 * list reads the way the house is laid out, kitchen before garage, and a shelf
 * directly under the room it is in. Anything homeless goes last, where it reads
 * as a to-do rather than as the first thing you own.
 */
function groupByPlace(items, places) {
  const buckets = new Map();
  for (const item of items) {
    const key = item.location_id ?? null;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  const out = [];
  for (const place of places) {
    if (buckets.has(place.id)) out.push({ id: place.id, items: buckets.get(place.id) });
  }
  // Whatever is left points at a place this phone has not synced yet; it still
  // has to appear somewhere, so it falls in with the homeless.
  const loose = [...buckets].filter(([id]) => !out.some(g => g.id === id)).flatMap(([, v]) => v);
  if (loose.length) out.push({ id: null, items: loose });
  return out;
}

/** "Kitchen › Pantry › Shelf 2", built from the depth the flat tree already carries. */
function pathLabels(places) {
  const labels = new Map();
  const stack = [];
  for (const place of places) {
    stack.length = place.depth;
    stack[place.depth] = place.name;
    labels.set(place.id, stack.slice(0, place.depth + 1).join(' › '));
  }
  return labels;
}

function chip(label, active, onclick) {
  return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(active), text: label, onclick });
}

function itemRow(item, categories, placeName, grouped = false) {
  const expiry = expiryState(item);
  // Under a place heading, repeating the place on every row is noise.
  const bits = [
    grouped ? null : placeName.get(item.location_id),
    categories.get(item.category_id)?.name,
  ].filter(Boolean).join(' · ');

  return el('div', { class: 'row item-row' }, [
    el('a', { class: 'row-main item-link', href: `#/item/${item.id}` }, [
      el('div', { class: 'row-title', text: item.name }),
      el('div', { class: 'row-sub' }, [
        bits || (grouped ? '' : 'No place set'),
        isLow(item) ? el('span', { class: 'badge badge-warn', text: 'Low' }) : null,
        expiry === 'expired' ? el('span', { class: 'badge badge-danger', text: 'Expired' })
          : expiry === 'soon' ? el('span', { class: 'badge badge-warn', text: 'Soon' }) : null,
      ]),
    ]),
    stepper(item, { compact: true }),
  ]);
}
