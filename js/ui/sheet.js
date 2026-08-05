// Bottom sheet. The app's one modal primitive — add/edit forms, pickers, and
// confirmations all use it, so there's a single dismissal and focus behaviour.

import { el, removeAfterExit } from './dom.js';

let openSheet = null;
const closeListeners = new Set();

/** Everything outside the sheet, switched off while one is up. */
const BACKDROP = '#app, #gate';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Is a modal on screen? Callers use this to avoid repainting underneath one. */
export function isOpen() {
  return Boolean(openSheet);
}

export function onClose(fn) {
  closeListeners.add(fn);
  return () => closeListeners.delete(fn);
}

export function sheet({ title, body, actions = [] } = {}) {
  // Taken before the previous sheet is torn down, so that closing one to open
  // another does not hand focus back to the screen in between.
  const opener = document.activeElement;
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
  openSheet = { scrim, panel, opener: opener === document.body ? null : opener };

  // Nothing behind a modal should be tabbable, clickable or readable to a screen
  // reader. `inert` does all three in one attribute; browsers without it fall
  // back to the Tab handling below, which is why both are here.
  for (const node of document.querySelectorAll(BACKDROP)) {
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
  }

  panel.querySelector('input, select, textarea, button')?.focus({ preventScroll: true });
  document.addEventListener('keydown', onKey);
  mountDrag(panel, scrim);

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
  const { scrim, panel, opener } = openSheet;
  openSheet = null;
  document.removeEventListener('keydown', onKey);

  for (const node of document.querySelectorAll(BACKDROP)) {
    node.inert = false;
    node.removeAttribute('aria-hidden');
  }

  // The spring-back transition has to go, or it competes with the exit
  // animation. The transform stays: the exit animates from wherever the finger
  // left it, rather than snapping back up to start again.
  panel.style.transition = '';
  scrim.style.transition = '';

  scrim.classList.add('is-out');
  panel.classList.add('is-out');
  removeAfterExit(scrim);
  removeAfterExit(panel);

  // Back to whatever opened the sheet — unless the screen was rebuilt while it
  // was up, in which case that node is gone and the view itself is the fallback.
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  else document.getElementById('view')?.focus({ preventScroll: true });

  for (const fn of closeListeners) {
    try { fn(); } catch (err) { console.error('[sheet] close listener failed', err); }
  }
}

function onKey(e) {
  if (e.key === 'Escape') return close();
  if (e.key !== 'Tab' || !openSheet) return;

  const items = [...openSheet.panel.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent);
  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = openSheet.panel.contains(active);

  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

/* ---- Drag to dismiss ---- */

// Far enough down the panel, or fast enough, counts as "put it away". The
// fraction is of the sheet's own height, so a tall form asks for a longer drag
// than a two-line confirmation — the gesture costs the same effort either way.
const DISMISS_FRACTION = 0.28;
const FLICK_PX_PER_MS = 0.5;
const SPRING = '220ms cubic-bezier(.2,.8,.25,1)';

/**
 * The grip at the top of every sheet is the universal "drag me down" affordance,
 * and for a long time it did nothing.
 *
 * A drag starts on the grip, or anywhere in content that is already scrolled to
 * the top — anywhere else, a downward swipe means scroll, and stealing it would
 * make a long form impossible to read. Fields never start one, or a textarea
 * could not be swiped through.
 */
function mountDrag(panel, scrim) {
  let startY = 0;
  let dy = 0;
  let dragging = false;
  // The last movement, not the whole gesture. Someone who drags a sheet halfway
  // down, holds it there while they read what is underneath, and then lets go
  // has not flicked it — but averaged over the whole gesture they look like they
  // have, and the sheet would vanish out from under the thing they were reading.
  let lastY = 0;
  let lastAt = 0;
  let velocity = 0;

  panel.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const onGrip = e.target.closest?.('.sheet-grip');
    const inField = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (!onGrip && (panel.scrollTop > 0 || inField)) return;

    dragging = true;
    dy = 0;
    velocity = 0;
    startY = lastY = e.touches[0].clientY;
    lastAt = e.timeStamp;
    // While a finger is on the glass the panel tracks it exactly: the entry
    // animation and any spring-back left over from a previous drag both have to
    // get out of the way, or the sheet lags behind the thumb.
    panel.classList.add('is-dragged');
    scrim.classList.add('is-dragged');
    panel.style.transition = 'none';
    scrim.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', e => {
    if (!dragging) return;
    const y = e.touches[0].clientY;
    const moved = y - startY;

    velocity = (y - lastY) / Math.max(1, e.timeStamp - lastAt);
    lastY = y;
    lastAt = e.timeStamp;

    // Upward is not a gesture here. Rather than rubber-banding, it simply pins
    // at rest, so a drag that overshoots and comes back is forgiving.
    if (moved <= 0) {
      dy = 0;
      panel.style.transform = '';
      scrim.style.opacity = '';
      return;
    }

    dy = moved;
    e.preventDefault();                        // or the screen behind scrolls too
    panel.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / (panel.offsetHeight || 1)));
  }, { passive: false });

  const release = e => {
    if (!dragging) return;
    dragging = false;

    // A finger that has come to rest before lifting is not flicking, however
    // fast it was travelling earlier.
    if (e.timeStamp - lastAt > 90) velocity = 0;

    if (dy > panel.offsetHeight * DISMISS_FRACTION || (dy > 0 && velocity > FLICK_PX_PER_MS)) {
      return close();
    }

    panel.style.transition = `transform ${SPRING}`;
    scrim.style.transition = `opacity ${SPRING}`;
    panel.style.transform = '';
    scrim.style.opacity = '';
    dy = 0;
  };

  panel.addEventListener('touchend', release);
  panel.addEventListener('touchcancel', release);
}
