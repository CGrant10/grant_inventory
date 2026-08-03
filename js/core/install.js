// Home-screen install.
//
// Chrome/Edge/Samsung hand us a beforeinstallprompt event we can fire on demand
// (stashed by the inline script in index.html so it can't be missed). iOS Safari
// has no such API — installing there is a manual Share -> Add to Home Screen, so
// the only honest thing to do is show the instructions.

import { on as busOn, emit, EVENTS } from './bus.js';

export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: window-controls-overlay)').matches
      || navigator.standalone === true;
}

export function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
      // iPadOS 13+ reports as a Mac; the touch points give it away.
      || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function canPrompt() {
  return Boolean(window.__installPrompt);
}

// The prompt event is single-use and Chrome will not re-fire it in the same page
// view. Remembering that we once had one lets us keep offering a route to install
// after a dismissal, instead of the button silently disappearing.
let everPromptable = Boolean(window.__installPrompt);
addEventListener('installable', () => { everPromptable = true; });

/**
 * What the UI should offer.
 *   installed   — nothing to do
 *   prompt      — fire the browser's own install dialog
 *   menu        — had a prompt, it's spent; point at the browser menu
 *   ios         — Safari: manual Share -> Add to Home Screen
 *   unavailable — no install path at all
 */
export function mode() {
  if (isInstalled()) return 'installed';
  if (canPrompt()) return 'prompt';
  if (everPromptable) return 'menu';
  if (isIOS()) return 'ios';
  return 'unavailable';
}

/**
 * Fire the browser's install dialog. Resolves 'accepted' | 'dismissed' | 'unavailable'.
 * The event is single-use — once fired it's spent, whatever the outcome.
 */
export async function promptInstall() {
  const deferred = window.__installPrompt;
  if (!deferred) return 'unavailable';

  window.__installPrompt = null;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  emit(EVENTS.INSTALL_CHANGED);
  return outcome;
}

/** Notify when installability changes, so screens can show or hide the button. */
export function onChange(fn) {
  const relay = () => { emit(EVENTS.INSTALL_CHANGED); fn(mode()); };
  addEventListener('installable', relay);
  addEventListener('installed', relay);
  const offBus = busOn(EVENTS.INSTALL_CHANGED, () => fn(mode()));
  return () => {
    removeEventListener('installable', relay);
    removeEventListener('installed', relay);
    offBus();
  };
}
