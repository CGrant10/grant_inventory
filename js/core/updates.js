// In-app updates.
//
// A service worker will happily serve the previous build for days, so the app
// asks the server directly: fetch version.txt, compare it to the VERSION baked
// into this bundle, and offer a button when they differ.
//
// version.txt MUST equal VERSION in config.js and the CACHE string in sw.js.
// If version.txt lags, the button never appears; if it leads, it never clears.

import { VERSION } from './config.js';
import { emit, on, EVENTS } from './bus.js';

let available = null;   // the newer version string, or null
let checking = false;
let lastCheck = 0;

const MIN_GAP_MS = 60_000;   // don't hammer the server on every tab focus

export function pending() {
  return available;
}

export function current() {
  return VERSION;
}

/**
 * Ask the server what the current build is.
 * @param {boolean} force  ignore the throttle (user pressed "Check now")
 * @returns {Promise<{status:'update'|'current'|'offline'|'error', version?:string}>}
 */
export async function check(force = false) {
  if (checking) return { status: 'current' };
  if (!force && Date.now() - lastCheck < MIN_GAP_MS) {
    return available ? { status: 'update', version: available } : { status: 'current' };
  }
  if (!navigator.onLine) return { status: 'offline' };

  checking = true;
  try {
    // Cache-bust twice over: no-store for the HTTP cache, a query string for
    // the service worker and any CDN in between.
    const res = await fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const latest = (await res.text()).trim();
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error(`Unexpected version.txt: "${latest}"`);

    lastCheck = Date.now();
    available = latest === VERSION ? null : latest;
    emit(EVENTS.UPDATE_STATE, available);
    return available ? { status: 'update', version: available } : { status: 'current' };
  } catch (err) {
    if (!navigator.onLine) return { status: 'offline' };
    console.warn('[updates] check failed', err);
    return { status: 'error', message: err.message };
  } finally {
    checking = false;
  }
}

/**
 * Install the new build.
 *
 * Unregistering the worker before reloading is deliberate. Deleting caches alone
 * still leaves the old worker in control of the next navigation, which is how a
 * PWA ends up serving a stale build after you "updated" it. The page re-registers
 * on load, so offline support is back within a second.
 */
export async function apply() {
  try {
    for (const key of await caches.keys()) await caches.delete(key);
  } catch (err) {
    console.warn('[updates] could not clear caches', err);
  }

  try {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  } catch (err) {
    console.warn('[updates] could not unregister worker', err);
  }

  // Query string defeats the back/forward and HTTP caches for the document too.
  const url = new URL(location.href);
  url.searchParams.set('v', Date.now().toString(36));
  location.replace(url.toString());
}

/** Check on launch and whenever the app comes back to the foreground. */
export function start() {
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', () => check(true));
}

export function onChange(fn) {
  return on(EVENTS.UPDATE_STATE, fn);
}
