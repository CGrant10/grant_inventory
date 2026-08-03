// Quantity stepper.
//
// This is the control the app lives or dies by: using something up has to be one
// tap, from a moving car, one-handed. So the buttons are oversized, the number
// updates immediately, and the write is debounced — hitting minus four times
// sends one event of -4 rather than four events, which keeps the history
// readable and the outbox small.

import { el, icon, ICONS } from './dom.js';
import { itemRepo, fmtQty } from '../data/items.js';
import { toast } from './toast.js';

const SETTLE_MS = 700;

/**
 * @param {object} item              the item row
 * @param {object} opts
 * @param {boolean} opts.compact     smaller variant for list rows
 * @param {function=} opts.onChange  called with the updated item after each write
 */
export function stepper(item, { compact = false, onChange } = {}) {
  let shown = Number(item.quantity ?? 0);
  let pending = 0;
  let timer = null;

  const value = el('span', { class: 'step-value', text: fmtQty(shown) });
  const unit = compact ? null : el('span', { class: 'step-unit', text: item.unit || '' });

  const minus = button(ICONS.minus, 'Use one', () => bump(-1));
  const plus = button(ICONS.plus, 'Add one', () => bump(1));

  function render() {
    value.textContent = fmtQty(shown);
    minus.disabled = shown <= 0 && pending <= 0;
  }

  function bump(delta) {
    if (shown + delta < 0) return;
    shown += delta;
    pending += delta;
    render();

    clearTimeout(timer);
    timer = setTimeout(flush, SETTLE_MS);

    if (navigator.vibrate) navigator.vibrate(8);
  }

  async function flush() {
    const delta = pending;
    pending = 0;
    if (!delta) return;

    const { item: updated } = await itemRepo.adjustBy(
      item.id, delta, delta < 0 ? 'consume' : 'restock');

    shown = Number(updated.quantity ?? 0);
    render();
    onChange?.(updated);

    // Longer than the default: this is the only way back from a mis-tap, and
    // 2.6s is not enough time to notice the number is wrong and reach the button.
    toast(`${item.name}: ${delta > 0 ? '+' : ''}${delta}`, {
      ms: 6000,
      undo: async () => {
        const { item: reverted } = await itemRepo.adjustBy(item.id, -delta, 'adjust', 'undo');
        shown = Number(reverted.quantity ?? 0);
        render();
        onChange?.(reverted);
      },
    });
  }

  /** Write immediately — call before navigating away so nothing is lost. */
  function commit() {
    clearTimeout(timer);
    return flush();
  }

  render();

  const root = el('div', { class: `stepper${compact ? ' is-compact' : ''}` }, [
    minus,
    el('div', { class: 'step-readout' }, [value, unit]),
    plus,
  ]);
  root.commit = commit;
  return root;
}

function button(glyph, label, onclick) {
  return el('button', {
    class: 'step-btn',
    type: 'button',
    'aria-label': label,
    onclick: e => { e.preventDefault(); e.stopPropagation(); onclick(); },
  }, [icon(glyph, 22)]);
}
