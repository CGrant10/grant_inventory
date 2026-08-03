// Transient feedback. Undo lives here because most inventory actions (use one,
// restock, move) are one tap and want a cheap way back.

import { el } from './dom.js';

const root = () => document.getElementById('toasts');

export function toast(message, { kind = 'info', ms = 2600, undo = null } = {}) {
  const node = el('div', { class: 'toast', dataset: { kind } }, [
    el('span', { text: message }),
  ]);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };

  if (undo) {
    node.append(el('button', {
      class: 'toast-undo',
      text: 'Undo',
      onclick: async () => { dismiss(); await undo(); },
    }));
  }

  root().append(node);
  timer = setTimeout(dismiss, ms);
  return dismiss;
}

export function errorToast(message) {
  return toast(message, { kind: 'error', ms: 4200 });
}
