// Hash router. Routes are declared as patterns with :params.
//
// Hash-based because GitHub Pages has no server-side rewrites, and because a
// location QR that encodes `#/l/<slug>` must open straight to that bin.

const routes = [];
let outlet = null;
let onChange = null;
let current = null;

export function define(pattern, load, meta = {}) {
  const names = [];
  const rx = new RegExp('^' + pattern
    .replace(/\//g, '\\/')
    .replace(/:(\w+)/g, (_, name) => { names.push(name); return '([^/]+)'; })
    + '$');
  routes.push({ pattern, rx, names, load, meta });
}

function match(path) {
  for (const route of routes) {
    const m = route.rx.exec(path);
    if (m) {
      const params = {};
      route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

/** The route part of the hash, with any query string removed. */
export function path() {
  const raw = (location.hash || '#/home').slice(1) || '/home';
  return raw.split('?')[0] || '/home';
}

/** Query parameters from the hash, e.g. #/labels?only=pantry-2. */
export function query() {
  return new URLSearchParams((location.hash.split('?')[1] || ''));
}

export function go(to, { replace = false } = {}) {
  const hash = to.startsWith('#') ? to : `#${to}`;
  if (replace) {
    replacing = true;
    location.replace(hash);
    // A replace to the hash we are already on fires no hashchange at all, and
    // the flag would then be read by whatever navigation came next. Clear it on
    // the next task — hashchange was queued during location.replace, so a real
    // one still gets there first.
    setTimeout(() => { replacing = false; }, 0);
  } else {
    location.hash = hash;
  }
}

export function back(fallback = '/home') {
  if (history.length > 1) history.back();
  else go(fallback, { replace: true });
}

export function currentRoute() {
  return current;
}

// Renders are numbered so a slow screen that finishes after a newer navigation
// has already started can be dropped instead of painting over it.
let token = 0;

/* ---- Scroll memory ---- */

/**
 * Every history entry is stamped with a number, and the scroll position it was
 * left at is kept against that number.
 *
 * Without it, going back from an item to a three-hundred-row list lands at the
 * top of the list — the one place you already know you were not. The number has
 * to live in `history.state` rather than in a counter here, because that is the
 * only thing the browser hands back when someone presses Back: two entries for
 * the same path are different places, and the path alone cannot tell them apart.
 */
const scrollByEntry = new Map();
let entryIndex = 0;
let highestIndex = 0;
let replacing = false;          // set by go(..., { replace: true })

function stamp(index) {
  entryIndex = index;
  highestIndex = Math.max(highestIndex, index);
  history.replaceState({ ...history.state, giEntry: index }, '');
}

function onHashChange() {
  // Whatever we are leaving, remember where it was left.
  scrollByEntry.set(entryIndex, window.scrollY);
  const leaving = entryIndex;

  const seen = history.state?.giEntry;
  let restoreTo = 0;

  if (typeof seen === 'number') {
    // Back or forward to an entry that has been here before.
    entryIndex = seen;
    highestIndex = Math.max(highestIndex, seen);
    restoreTo = scrollByEntry.get(seen) ?? 0;
  } else {
    // A new entry. A replacement re-uses the number of the entry it replaced, or
    // the map fills with indices nothing can ever navigate back to.
    stamp(replacing ? leaving : highestIndex + 1);
  }

  replacing = false;
  return render({ navigated: true, restoreTo });
}

/** Long enough that a warm navigation never flashes a skeleton at all. */
const SKELETON_AFTER_MS = 150;

/**
 * @param {boolean} navigated  true for a real navigation, false for a re-render
 *   of the screen already on show. Only a navigation resets the scroll position:
 *   a background sync repainting the list under someone reading it must not
 *   throw them back to the top.
 * @param {number} restoreTo  where this history entry was left, for a Back that
 *   is returning to it. Zero — the top — for anywhere being opened fresh.
 */
async function render({ navigated = true, restoreTo = 0 } = {}) {
  const p = path();
  const hit = match(p) || match('/home');
  if (!hit) return;

  const mine = ++token;
  current = { path: p, ...hit };

  // The outlet is deliberately NOT cleared here. Clearing first and then
  // awaiting the module and its data means every tap shows an empty screen for
  // as long as that takes — which on a cold import is long enough to read as a
  // broken app. Hold the previous screen until there is something to replace it
  // with, and only admit to being slow if it actually is.
  const scrollY = window.scrollY;
  const slow = setTimeout(() => {
    if (mine === token) outlet.replaceChildren(skeleton());
  }, SKELETON_AFTER_MS);

  let view;
  try {
    const mod = await hit.route.load();
    view = await (mod.default ?? mod.render)(hit.params, outlet);
  } catch (err) {
    console.error('[router]', err);
    view = errorView(err);
  }

  clearTimeout(slow);
  if (mine !== token) return;                 // a newer navigation won the race

  outlet.replaceChildren(view instanceof Node ? view : '');

  if (navigated) {
    // Top first regardless, so a screen with nothing remembered never inherits
    // the last one's position while the new content is still being laid out.
    outlet.scrollTop = 0;
    window.scrollTo(0, 0);
    restoreScroll(restoreTo);
    animateIn(outlet);
  } else {
    restoreScroll(scrollY);
  }

  onChange?.(current);
}

/**
 * Put the scroll position back after a re-render.
 *
 * Restoring it in the same tick is not enough: the replacement content has not
 * been laid out yet, so the document is briefly short and the browser clamps the
 * request down — usually to zero, which is the exact behaviour this is here to
 * prevent. Ask again on the next frame, once the height is real.
 */
function restoreScroll(y) {
  if (!y) return;
  window.scrollTo(0, y);
  requestAnimationFrame(() => {
    if (window.scrollY === y) return;
    window.scrollTo(0, y);
    // One more frame for a screen whose height arrives late — a list of places
    // with photo strips is taller on its second layout than its first. Only ever
    // downward-clamped positions are retried, so someone who has already started
    // scrolling back up is left alone.
    requestAnimationFrame(() => {
      if (window.scrollY < y) window.scrollTo(0, y);
    });
  });
}

/**
 * A brief rise-and-fade on the incoming screen.
 *
 * Deliberately one animation on the container rather than a stagger down the
 * rows: a stagger is charming once and tiresome by the fourth tab tap, and it
 * delays the thing the person came to read.
 */
function animateIn(node) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  node.classList.remove('is-entering');
  void node.offsetWidth;                      // restart the animation on re-entry
  node.classList.add('is-entering');
}

/** Shaped like a list, because that is what most screens turn out to be. */
function skeleton() {
  const wrap = document.createElement('div');
  wrap.className = 'skeleton';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 5; i++) {
    const row = document.createElement('div');
    row.className = 'skeleton-row';
    wrap.append(row);
  }
  return wrap;
}

function errorView(err) {
  const el = document.createElement('div');
  el.className = 'empty';
  el.innerHTML = `<div class="empty-title">Something went wrong</div>
                  <div class="empty-body"></div>`;
  el.querySelector('.empty-body').textContent = err.message;
  return el;
}

export function start(outletEl, changeHandler) {
  outlet = outletEl;
  onChange = changeHandler;
  window.addEventListener('hashchange', onHashChange);
  if (!location.hash) location.replace('#/home');

  // The entry the app booted on. A reload lands back on a stamped one, and its
  // number has to be adopted rather than reset, or the entries behind it in the
  // session's history all collide with the numbers handed out from here.
  const seen = history.state?.giEntry;
  stamp(typeof seen === 'number' ? seen : 0);

  return render();
}

/**
 * Re-run the current screen in place — same path, same scroll position.
 *
 * Used after a local write and when a sync brings in someone else's changes.
 * It is not a navigation and must not behave like one.
 */
export function refresh() {
  return render({ navigated: false });
}
