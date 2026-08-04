// The shopping list. Built for use in a shop: big tap targets, one gesture per
// item, and the quantity right there so you know whether to grab one or three.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { shoppingRepo, STATUS } from '../data/shopping.js';
import { reconcile } from '../features/low-stock.js';
import { fmtQty } from '../data/items.js';
import { sheet, close, confirmSheet } from '../ui/sheet.js';
import { toast, errorToast } from '../ui/toast.js';
import { flip } from '../ui/flip.js';
import { UNITS } from '../core/model.js';

export default async function shopping() {
  await reconcile();

  // The screen owns a root it can repaint itself, rather than asking the router
  // to rebuild the page. That is what makes the movement animatable: a tick
  // moves one row between two sections, and the rest of the screen holds still.
  const root = el('div', { class: 'stack' });

  const repaint = async ({ animate = true } = {}) => {
    const lines = await shoppingRepo.list();
    const build = () => root.replaceChildren(...content(lines, repaint));
    if (animate) flip(root, build);
    else build();
  };

  await repaint({ animate: false });
  return root;
}

function content(lines, repaint) {
  const needed = lines.filter(l => l.status === STATUS.NEEDED);
  const inCart = lines.filter(l => l.status === STATUS.IN_CART);
  const bought = lines.filter(l => l.status === STATUS.PURCHASED);

  const addButton = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => addForm(repaint),
  }, [icon(ICONS.plus, 20), el('span', { text: 'Add to the list' })]);

  if (!lines.length) {
    return [
      empty({
        glyph: ICONS.cart,
        title: 'Nothing to buy',
        body: 'Set a minimum on the things you hate running out of, and they will '
            + 'appear here on their own when they get low.',
      }),
      addButton,
    ];
  }

  return [
    section(`To buy (${needed.length})`, needed, 'needed', repaint),
    inCart.length ? section(`In the cart (${inCart.length})`, inCart, 'cart', repaint) : null,
    bought.length ? boughtSection(bought, repaint) : null,
    addButton,
  ].filter(Boolean);
}

function section(title, lines, kind, repaint) {
  return el('div', {}, [
    el('div', { class: 'section-title', text: title }),
    lines.length
      ? el('div', { class: 'list' }, lines.map(line => row(line, kind, repaint)))
      : el('p', { class: 'help pad', text: 'Nothing here.' }),
  ]);
}

function boughtSection(lines, repaint) {
  return el('div', {}, [
    el('div', { class: 'section-title' }, [
      el('span', { text: `Bought (${lines.length})` }),
      el('button', {
        class: 'link-btn',
        text: 'Clear',
        onclick: async () => {
          const ok = await confirmSheet({
            title: 'Clear the bought items?',
            message: 'They leave the list on every phone. Your stock is unaffected.',
            confirmLabel: 'Clear',
          });
          if (!ok) return;
          const n = await shoppingRepo.clearPurchased();
          toast(`Cleared ${n}`);
          repaint();
        },
      }),
    ]),
    el('div', { class: 'list' }, lines.map(line => row(line, 'bought', repaint))),
  ]);
}

function row(line, kind, repaint) {
  const qty = `${fmtQty(line.quantity)} ${line.unit || ''}`.trim();

  // The primary tap: needed -> in the cart -> bought. One finger, no menus.
  const advance = async () => {
    try {
      if (kind === 'needed') {
        await shoppingRepo.setStatus(line.id, STATUS.IN_CART);
      } else if (kind === 'cart') {
        const { restocked } = await shoppingRepo.purchase(line.id);
        toast(restocked
          ? `${line.name} → ${fmtQty(restocked.quantity)} ${restocked.unit || ''}`.trim()
          : `${line.name} bought`, {
          ms: 6000,
          undo: async () => { await shoppingRepo.unpurchase(line.id); repaint(); },
        });
      } else {
        await shoppingRepo.unpurchase(line.id);
      }
      // A tick is worth feeling as well as seeing.
      if (navigator.vibrate) navigator.vibrate(8);
      repaint();
    } catch (err) {
      errorToast(err.message);
    }
  };

  const box = el('button', {
    class: `tickbox is-${kind}`,
    type: 'button',
    'aria-label': kind === 'bought' ? 'Put back on the list' : 'Tick off',
    onclick: advance,
  }, kind === 'needed' ? [] : [icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 20)]);

  // The key the movement is tracked by: the row is rebuilt on every repaint, so
  // identity has to come from the data, not from the element.
  return el('div', {
    class: `row shop-row${kind === 'bought' ? ' is-done' : ''}`,
    dataset: { flipKey: line.id },
  }, [
    box,
    el('button', { class: 'row-main shop-main', onclick: () => editForm(line, repaint) }, [
      el('div', { class: 'row-title', text: line.name }),
      el('div', { class: 'row-sub' }, [
        qty,
        line.auto_generated ? el('span', { class: 'badge badge-warn', text: 'Low' }) : null,
      ]),
    ]),
  ]);
}

function addForm(repaint) {
  const name = el('input', { class: 'field', type: 'text', placeholder: 'What do you need?', autocapitalize: 'sentences' });
  const qty = el('input', { class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: '1' });
  const unit = el('select', { class: 'field' }, UNITS.map(u => el('option', { value: u, text: u })));

  const save = async () => {
    const trimmed = name.value.trim();
    if (!trimmed) return errorToast('Give it a name.');
    await shoppingRepo.add({ name: trimmed, quantity: Number(qty.value) || 1, unit: unit.value });
    close();
    toast(`Added ${trimmed}`);
    repaint();
  };

  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

  sheet({
    title: 'Add to the list',
    body: el('div', { class: 'stack-sm' }, [
      name,
      el('div', { class: 'field-pair' }, [qty, unit]),
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'Add', onclick: save }),
    ],
  });
}

function editForm(line, repaint) {
  const qty = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any',
    value: String(line.quantity),
  });

  const save = async () => {
    await shoppingRepo.setQuantity(line.id, Number(qty.value));
    close();
    repaint();
  };

  sheet({
    title: line.name,
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: `How many ${line.unit || ''}?`.trim() }),
      qty,
      line.auto_generated
        ? el('p', { class: 'help', text:
            'Added automatically because this is at or below its minimum. It leaves '
            + 'the list on its own once the shelf is full again.' })
        : null,
    ]),
    actions: [
      el('button', {
        class: 'btn btn-danger btn-block',
        text: 'Remove from list',
        onclick: async () => {
          await shoppingRepo.softDelete(line.id);
          close();
          toast(`Removed ${line.name}`);
          repaint();
        },
      }),
      el('button', { class: 'btn btn-primary btn-block', text: 'Save', onclick: save }),
    ],
  });
}
