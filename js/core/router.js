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

export function path() {
  return (location.hash || '#/home').slice(1) || '/home';
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

async function render() {
  const p = path();
  const hit = match(p) || match('/home');
  if (!hit) return;

  current = { path: p, ...hit };
  outlet.replaceChildren();

  let view;
  try {
    const mod = await hit.route.load();
    view = await (mod.default ?? mod.render)(hit.params, outlet);
  } catch (err) {
    console.error('[router]', err);
    view = errorView(err);
  }

  if (view instanceof Node) outlet.replaceChildren(view);
  outlet.scrollTop = 0;
  window.scrollTo(0, 0);
  onChange?.(current);
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

export function refresh() {
  return render();
}
