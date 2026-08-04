// Bottom sheet. The app's one modal primitive — add/edit forms, pickers, and
// confirmations all use it, so there's a single dismissal and focus behaviour.

import { el, removeAfterExit } from './dom.js';

let openSheet = null;
const closeListeners = new Set();

/** Is a modal on screen? Callers use this to avoid repainting underneath one. */
export function isOpen() {
  return Boolean(openSheet);
}

export function onClose(fn) {
  closeListeners.add(fn);
  return () => closeListeners.delete(fn);
}

export function sheet({ title, body, actions = [] } = {}) {
  close();

  const root = document.getElementById('sheet-root');
  const scrim = el('div', { class: 'sheet-scrim', onclick: () => close() });
  const panel = el('div', {
    class: 'sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || 'Dialog',
  }, [
    el('div', { class: 'sheet-grip' }),
    title && el('div', { class: 'sheet-title', text: title }),
    body,
    actions.length ? el('div', { class: 'sheet-actions' }, actions) : null,
  ]);

  root.append(scrim, panel);
  openSheet = { scrim, panel };

  panel.querySelector('input, select, textarea, button')?.focus({ preventScroll: true });
  document.addEventListener('keydown', onKey);

  return { close, panel };
}

/** Sheet that resolves to true/false. */
export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const finish = value => { close(); resolve(value); };
    sheet({
      title,
      body: el('p', { class: 'sheet-message', text: message }),
      actions: [
        el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => finish(false) }),
        el('button', {
          class: `btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}`,
          text: confirmLabel,
          onclick: () => finish(true),
        }),
      ],
    });
  });
}

export function close() {
  if (!openSheet) return;
  const { scrim, panel } = openSheet;
  openSheet = null;
  document.removeEventListener('keydown', onKey);
  scrim.classList.add('is-out');
  panel.classList.add('is-out');
  removeAfterExit(scrim);
  removeAfterExit(panel);

  for (const fn of closeListeners) {
    try { fn(); } catch (err) { console.error('[sheet] close listener failed', err); }
  }
}

function onKey(e) {
  if (e.key === 'Escape') close();
}
