// Quick log — the "I just took a banana" screen.
//
// The full inventory is too many taps for someone who does not care about the
// app. This is a wall of big buttons, ordered by what the household actually
// uses, where one tap is one unit. It is also the target for voice shortcuts:
//   #/quick?use=banana   deducts one and says so
//   #/quick?add=banana   puts one back
// Matching is by name so a spoken phrase can drive it without knowing any ids.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { itemRepo, fmtQty } from '../data/items.js';
import { toast, errorToast } from '../ui/toast.js';
import { query, go, refresh } from '../core/router.js';
import { sheet, close } from '../ui/sheet.js';
import * as idb from '../core/idb.js';

const MODE_KEY = 'gi.quickMode';

export default async function quick() {
  const [items, events] = await Promise.all([
    itemRepo.all(),
    idb.all('item_events', { includeDeleted: true }),
  ]);

  // Act on a deep link before drawing anything: arriving here from a shortcut
  // should feel like the action happened, not like a screen opened.
  const useName = query().get('use');
  const addName = query().get('add');
  if (useName || addName) {
    const handled = await runByName(items, useName || addName, useName ? -1 : 1);
    // Strip the parameter so a refresh or a back-tap cannot repeat the action.
    history.replaceState(null, '', location.pathname + location.search + '#/quick');
    if (handled) return quick();
  }

  if (!items.length) {
    return empty({
      glyph: ICONS.box,
      title: 'Nothing to log yet',
      body: 'Add a few items and the ones you use most will appear here as big buttons.',
      action: el('a', { class: 'btn', href: '#/inventory', text: 'Add items' }),
    });
  }

  let mode = localStorage.getItem(MODE_KEY) || 'use';

  const modeRow = el('div', { class: 'chip-row quick-modes' }, [
    modeChip('Took one', 'use'),
    modeChip('Put one back', 'add'),
  ]);

  function modeChip(label, id) {
    return el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(id === mode), text: label,
      onclick: e => {
        mode = id;
        localStorage.setItem(MODE_KEY, mode);
        for (const chip of e.currentTarget.parentElement.children) {
          chip.setAttribute('aria-pressed', String(chip === e.currentTarget));
        }
        grid.dataset.mode = mode;
      },
    });
  }

  const ranked = rankByUse(items, events);
  const search = el('input', {
    class: 'field', type: 'search', placeholder: 'Find something else…',
    autocapitalize: 'none', autocomplete: 'off',
  });

  const grid = el('div', { class: 'quick-grid-lg', dataset: { mode } });

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = (q ? items.filter(i => i.name.toLowerCase().includes(q)) : ranked).slice(0, 24);
    grid.replaceChildren(...(shown.length
      ? shown.map(item => tile(item, () => mode))
      : [el('p', { class: 'help pad', text: 'Nothing matches that.' })]));
  }

  search.addEventListener('input', render);
  render();

  return el('div', { class: 'stack' }, [
    modeRow,
    grid,
    search,
    el('p', { class: 'help', text:
      'Ordered by what gets used most. One tap is one unit — there is an undo on '
      + 'every tap, so it is hard to get wrong.' }),
    el('a', { class: 'btn btn-block', href: '#/settings', text: 'Set up a voice shortcut' }),
  ]);
}

function tile(item, getMode) {
  const count = el('span', { class: 'qt-count', text: fmtQty(item.quantity) });

  const button = el('button', {
    class: 'quick-tile',
    type: 'button',
    onclick: async () => {
      const delta = getMode() === 'use' ? -1 : 1;
      const { item: updated } = await itemRepo.adjustBy(
        item.id, delta, delta < 0 ? 'consume' : 'restock');

      count.textContent = fmtQty(updated.quantity);
      item.quantity = updated.quantity;
      if (navigator.vibrate) navigator.vibrate(12);

      toast(`${updated.name} ${delta < 0 ? '−1' : '+1'} → ${fmtQty(updated.quantity)}`, {
        ms: 6000,
        undo: async () => {
          const { item: back } = await itemRepo.adjustBy(item.id, -delta, 'adjust', 'undo');
          count.textContent = fmtQty(back.quantity);
          item.quantity = back.quantity;
        },
      });
    },
  }, [
    el('span', { class: 'qt-name', text: item.name }),
    count,
  ]);

  return button;
}

/**
 * Most-used first, counting consume events from the last 90 days. Recency
 * matters more than lifetime totals — what the house is getting through now is
 * what wants to be under a thumb.
 */
function rankByUse(items, events) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const score = new Map();

  for (const e of events) {
    if (e.type !== 'consume' || e.created_at < since) continue;
    score.set(e.item_id, (score.get(e.item_id) ?? 0) + 1);
  }

  return [...items].sort((a, b) =>
    (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Find an item from a spoken or typed name and apply a delta.
 * Exact match wins, then "starts with", then "contains" — so "banana" finds
 * "Bananas" and "milk" finds "Whole milk" without a picker.
 */
async function runByName(items, spoken, delta) {
  const want = String(spoken).trim().toLowerCase();
  if (!want) return false;

  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const target = norm(want);

  const exact = items.filter(i => norm(i.name) === target);
  const starts = items.filter(i => norm(i.name).startsWith(target));
  const has = items.filter(i => norm(i.name).includes(target)
                             || target.includes(norm(i.name)));
  const matches = exact.length ? exact : starts.length ? starts : has;

  if (!matches.length) {
    errorToast(`Nothing here called “${spoken}”.`);
    return false;
  }

  if (matches.length > 1) {
    // Ambiguous: ask rather than guess. Guessing wrong silently is worse than
    // one extra tap.
    sheet({
      title: `Which one?`,
      body: el('div', { class: 'list' }, matches.slice(0, 8).map(i =>
        el('button', {
          class: 'row',
          onclick: async () => { close(); await applyDelta(i, delta); refresh(); },
        }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title', text: i.name }),
            el('div', { class: 'row-sub', text: `${fmtQty(i.quantity)} ${i.unit || ''}`.trim() }),
          ]),
        ]))),
      actions: [el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() })],
    });
    return false;
  }

  await applyDelta(matches[0], delta);
  return true;
}

async function applyDelta(item, delta) {
  const { item: updated } = await itemRepo.adjustBy(
    item.id, delta, delta < 0 ? 'consume' : 'restock');
  if (navigator.vibrate) navigator.vibrate(12);
  toast(`${updated.name} ${delta < 0 ? '−1' : '+1'} → ${fmtQty(updated.quantity)} ${updated.unit || ''}`.trim(), {
    ms: 6000,
    undo: async () => { await itemRepo.adjustBy(item.id, -delta, 'adjust', 'undo'); refresh(); },
  });
}
