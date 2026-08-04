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
  if (replace) location.replace(hash);
  else location.hash = hash;
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

/** Long enough that a warm navigation never flashes a skeleton at all. */
const SKELETON_AFTER_MS = 150;

/**
 * @param {boolean} navigated  true for a real navigation, false for a re-render
 *   of the screen already on show. Only a navigation resets the scroll position:
 *   a background sync repainting the list under someone reading it must not
 *   throw them back to the top.
 */
async function render({ navigated = true } = {}) {
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
    outlet.scrollTop = 0;
    window.scrollTo(0, 0);
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
    if (window.scrollY !== y) window.scrollTo(0, y);
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
  window.addEventListener('hashchange', render);
  if (!location.hash) location.replace('#/home');
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
