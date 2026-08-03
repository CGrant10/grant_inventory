// Scan. The fast path: point, and the app does the obvious thing.
//
// A location label always opens that place — that is what scanning a bin means,
// whatever mode is selected. A product barcode is acted on according to the
// mode, because "I just used one" and "I just bought three" are the two things
// you do at a shelf.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { Scanner, capabilities, locationSlugFrom, isProductCode } from '../core/scanner.js';
import { locationRepo } from '../data/locations.js';
import { productRepo } from '../data/products.js';
import { itemRepo, fmtQty } from '../data/items.js';
import { lookup, remember } from '../features/barcode-lookup.js';
import { sheet, close } from '../ui/sheet.js';
import { toast, errorToast } from '../ui/toast.js';
import { itemForm } from '../ui/item-form.js';
import { go } from '../core/router.js';

const MODES = [
  { id: 'use', label: 'Use −1' },
  { id: 'restock', label: 'Restock +1' },
  { id: 'look', label: 'Look up' },
];

const MODE_KEY = 'gi.scanMode';

export default async function scan() {
  const caps = capabilities();

  if (!caps.camera || !caps.secure) {
    return empty({
      glyph: ICONS.warn,
      title: caps.secure ? 'No camera available' : 'Camera needs HTTPS',
      body: caps.secure
        ? 'This browser will not give the app a camera. You can still add and change items by hand.'
        : 'Open the app from its https:// address and the camera will work.',
      action: el('a', { class: 'btn', href: '#/inventory', text: 'Go to items' }),
    });
  }

  let mode = localStorage.getItem(MODE_KEY) || 'use';
  let scanner = null;
  let busy = false;

  const video = el('video', { class: 'scan-video', playsinline: true, muted: true });
  const status = el('p', { class: 'help scan-status', text: 'Starting the camera…' });

  const modeRow = el('div', { class: 'chip-row scan-modes' },
    MODES.map(m => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(m.id === mode), text: m.label,
      onclick: e => {
        mode = m.id;
        localStorage.setItem(MODE_KEY, mode);
        for (const chip of e.currentTarget.parentElement.children) {
          chip.setAttribute('aria-pressed', String(chip === e.currentTarget));
        }
        scanner?.forget();
      },
    })));

  const torchBtn = el('button', {
    class: 'btn scan-torch', type: 'button', hidden: true, text: 'Light',
    onclick: async () => {
      torchBtn.dataset.on = torchBtn.dataset.on === 'on' ? '' : 'on';
      await scanner?.torch(torchBtn.dataset.on === 'on');
    },
  });

  const frame = el('div', { class: 'scan-frame' }, [
    video,
    el('div', { class: 'scan-reticle' }),
    torchBtn,
  ]);

  const view = el('div', { class: 'stack' }, [
    frame,
    modeRow,
    status,
    caps.qr ? null : el('p', { class: 'help', text:
      'This browser can read product barcodes but not QR codes. To open a bin from '
      + 'its printed label, point your phone’s normal camera app at it instead.' }),
    el('button', {
      class: 'btn btn-block',
      onclick: () => itemForm({}),
      text: 'Add something by hand',
    }),
  ]);

  async function handle({ code }) {
    if (busy) return;
    busy = true;
    try {
      const result = await processScan({
        code,
        mode,
        onStatus: text => { status.textContent = text; },
        beforeNavigate: () => scanner?.stop(),
      });
      if (result.kind === 'unrecognised') {
        toast('That code is not a product barcode or a bin label');
      }
    } catch (err) {
      errorToast(err.message);
    } finally {
      busy = false;
    }
  }

  // The camera must be released when leaving, or the light stays on and the
  // phone keeps burning battery on a page nobody is looking at.
  const teardown = () => scanner?.stop();
  window.addEventListener('hashchange', teardown, { once: true });
  window.addEventListener('pagehide', teardown, { once: true });

  queueMicrotask(async () => {
    scanner = new Scanner({
      video,
      onResult: handle,
      onError: err => console.warn('[scan]', err),
    });
    try {
      await scanner.start();
      status.textContent = caps.native
        ? 'Point at a barcode or a bin label.'
        : 'Point at a product barcode.';
      if (scanner.hasTorch()) torchBtn.hidden = false;
    } catch (err) {
      frame.hidden = true;
      status.textContent = err.message;
    }
  });

  return view;
}


/**
 * Decide what a scanned code means and act on it. Exported separately from the
 * screen so the decision path can be exercised without a camera.
 *
 * @returns {Promise<{kind:'place'|'product'|'unrecognised', ...}>}
 */
export async function processScan({ code, mode = 'use', onStatus = () => {}, beforeNavigate = () => {} }) {
  const slug = locationSlugFrom(code);
  if (slug) {
    const place = await locationRepo.bySlug(slug);
    if (!place) {
      onStatus('That label points at a place this phone does not have yet.');
      return { kind: 'place', found: false, slug };
    }
    beforeNavigate();
    go(`/l/${place.qr_slug}`);
    return { kind: 'place', found: true, place };
  }

  if (isProductCode(code)) {
    // handleProduct writes to a DOM-ish node; give it one that forwards instead.
    const outcome = await handleProduct(code, mode, { set textContent(v) { onStatus(v); } });
    return { kind: 'product', ...outcome };
  }

  onStatus(`Scanned: ${code}`);
  return { kind: 'unrecognised', code };
}

/* ---- Product handling ---- */

async function handleProduct(barcode, mode, status) {
  const found = await lookup(barcode);

  if (found.source === 'local') {
    const items = await productRepo.items(found.product.id);
    const live = items.filter(i => !i.deleted_at);

    if (!live.length) { offerToAdd(found.product, barcode, status); return { action: 'offer-add', product: found.product }; }
    if (live.length === 1) { const item = await applyMode(live[0], mode, status); return { action: mode, item }; }
    await pickItem(live, mode, status);
    return { action: 'pick', count: live.length };
  }

  // Not in our catalog. Offer a prefilled form — from Open Food Facts if it
  // knows the code, otherwise blank with the barcode remembered either way.
  offerToCreate(barcode, found.suggestion, status);
  return { action: 'offer-create', known: Boolean(found.suggestion), suggestion: found.suggestion };
}

async function applyMode(item, mode, status) {
  if (mode === 'look') {
    go(`/item/${item.id}`);
    return item;
  }

  const delta = mode === 'use' ? -1 : 1;
  const { item: updated } = await itemRepo.adjustBy(
    item.id, delta, delta < 0 ? 'consume' : 'restock');

  status.textContent = `${updated.name}: ${fmtQty(updated.quantity)} ${updated.unit || ''}`.trim();
  toast(`${updated.name} ${delta > 0 ? '+1' : '−1'} → ${fmtQty(updated.quantity)}`, {
    ms: 6000,
    undo: async () => {
      await itemRepo.adjustBy(item.id, -delta, 'adjust', 'undo');
      toast('Put back');
    },
  });
  return updated;
}

/** Same product in more than one place — ask which one you are standing at. */
function pickItem(items, mode, status) {
  return new Promise(resolve => {
    sheet({
      title: 'Which one?',
      body: el('div', { class: 'list' }, items.map(i =>
        el('button', {
          class: 'row',
          onclick: async () => { close(); await applyMode(i, mode, status); resolve(); },
        }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title', text: i.name }),
            el('div', { class: 'row-sub', text: `${fmtQty(i.quantity)} ${i.unit || ''}`.trim() }),
          ]),
        ]))),
      actions: [el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => { close(); resolve(); } })],
    });
  });
}

/** Known product, but nothing in stock anywhere. */
function offerToAdd(product, barcode, status) {
  status.textContent = `${product.name} — not in stock anywhere`;
  sheet({
    title: product.name,
    body: el('div', { class: 'stack-sm' }, [
      el('p', { class: 'help', text: 'You have scanned this before, but there is none recorded. Add some?' }),
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Not now', onclick: () => close() }),
      el('button', {
        class: 'btn btn-primary btn-block', text: 'Add to inventory',
        onclick: () => {
          close();
          itemForm({ prefill: { name: product.name, unit: product.default_unit, product_id: product.id } });
        },
      }),
    ],
  });
}

/** Unknown barcode. Remember it either way, so the next scan is instant. */
function offerToCreate(barcode, suggestion, status) {
  const known = Boolean(suggestion);
  status.textContent = known ? `Found: ${suggestion.name}` : `Unknown barcode ${barcode}`;

  sheet({
    title: known ? suggestion.name : 'New barcode',
    body: el('div', { class: 'stack-sm' }, [
      suggestion?.image_url
        ? el('img', { class: 'scan-thumb', src: suggestion.image_url, alt: '' })
        : null,
      el('p', { class: 'help', text: known
        ? `${suggestion.brand ? suggestion.brand + ' · ' : ''}${suggestion.size || ''} — from Open Food Facts. Add it to your inventory?`
        : `Nothing online knows ${barcode}. Name it once and this phone — and every other one — will recognise it from now on.` }),
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn btn-primary btn-block',
        text: known ? 'Add it' : 'Name it',
        onclick: async () => {
          close();

          if (known) {
            const product = await remember({
              barcode,
              name: suggestion.name,
              brand: suggestion.brand ?? null,
              image_url: suggestion.image_url ?? null,
              source: 'off',
            });
            itemForm({
              prefill: { name: product.name, product_id: product.id, unit: product.default_unit || 'ea' },
            });
            return;
          }

          // Nothing to prefill, so leave the field empty rather than seeding it
          // with "Item 0000000000000". The product is created afterwards from
          // whatever the user actually called it.
          itemForm({
            onDone: async item => {
              const product = await remember({ barcode, name: item.name, source: 'manual' });
              await itemRepo.update(item.id, { product_id: product.id });
            },
          });
        },
      }),
    ],
  });
}
