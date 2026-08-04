// Everything you own, searchable, with the quantity adjustable without leaving
// the list — the common case is "use one", not "open the item and study it".

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { itemRepo, isLow, expiryState } from '../data/items.js';
import { categoryRepo } from '../data/categories.js';
import { locationRepo } from '../data/locations.js';
import { itemForm } from '../ui/item-form.js';
import { stepper } from '../ui/stepper.js';
import { query, go } from '../core/router.js';

export default async function inventory() {
  const [items, categories, places] = await Promise.all([
    itemRepo.all(),
    categoryRepo.map(),
    locationRepo.flatTree(),
  ]);

  const placeName = new Map(places.map(p => [p.id, p.name]));
  const filter = query().get('filter') || 'all';
  const addButton = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => itemForm({}),
  }, [icon(ICONS.plus, 20), el('span', { text: 'Add an item' })]);

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
    ]);
  }

  const search = el('input', {
    class: 'field', type: 'search', placeholder: 'Search items…',
    autocapitalize: 'none', autocomplete: 'off',
  });

  const list = el('div', { class: 'list' });
  const count = el('div', { class: 'section-title' });

  const filters = el('div', { class: 'chip-row' }, [
    chip('All', filter === 'all', () => go('/inventory')),
    chip('Running low', filter === 'low', () => go('/inventory?filter=low')),
    chip('Expiring', filter === 'expiring', () => go('/inventory?filter=expiring')),
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
    list.replaceChildren(...(rows.length
      ? rows.map(item => itemRow(item, categories, placeName))
      : [el('p', { class: 'help pad', text: 'Nothing matches that.' })]));
  }

  search.addEventListener('input', render);
  render();

  return el('div', { class: 'stack' }, [search, filters, count, list, addButton]);
}

function chip(label, active, onclick) {
  return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(active), text: label, onclick });
}

function itemRow(item, categories, placeName) {
  const expiry = expiryState(item);
  const bits = [
    placeName.get(item.location_id),
    categories.get(item.category_id)?.name,
  ].filter(Boolean).join(' · ');

  return el('div', { class: 'row item-row' }, [
    el('a', { class: 'row-main item-link', href: `#/item/${item.id}` }, [
      el('div', { class: 'row-title', text: item.name }),
      el('div', { class: 'row-sub' }, [
        bits || 'No place set',
        isLow(item) ? el('span', { class: 'badge badge-warn', text: 'Low' }) : null,
        expiry === 'expired' ? el('span', { class: 'badge badge-danger', text: 'Expired' })
          : expiry === 'soon' ? el('span', { class: 'badge badge-warn', text: 'Soon' }) : null,
      ]),
    ]),
    stepper(item, { compact: true }),
  ]);
}
