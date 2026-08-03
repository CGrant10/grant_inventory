// Service worker. CACHE must be bumped in lockstep with VERSION in
// js/core/config.js and version.txt, or phones keep serving the old build.

const CACHE = 'grant-inventory-v0.7.4';

// The shell. Everything needed to open the app with no network at all.
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/screens.css',
  'js/main.js',
  'js/core/config.js',
  'js/core/model.js',
  'js/core/bus.js',
  'js/core/idb.js',
  'js/core/supabase.js',
  'js/core/auth.js',
  'js/core/sync.js',
  'js/core/router.js',
  'js/core/install.js',
  'js/core/updates.js',
  'js/data/base.js',
  'js/data/members.js',
  'js/data/locations.js',
  'js/vendor/qr.js',
  'js/ui/qr.js',
  'js/ui/place-form.js',
  'js/screens/locations.js',
  'js/screens/location.js',
  'js/screens/labels.js',
  'js/ui/dom.js',
  'js/ui/toast.js',
  'js/ui/sheet.js',
  'js/ui/install.js',
  'js/screens/home.js',
  'js/screens/home-info.js',
  'js/screens/settings.js',
  'js/screens/placeholder.js',
  'assets/logo.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/favicon-32.png',
  'assets/icons/favicon-64.png',
  'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Two things matter here:
    //   cache: 'reload'  — bypass the browser's own HTTP cache, otherwise a
    //                      "fresh" install can re-cache the build we're replacing
    //   individual adds  — addAll is all-or-nothing, so one bad path would
    //                      abort the whole install
    await Promise.all(SHELL.map(url =>
      cache.add(new Request(url, { cache: 'reload' }))
        .catch(err => console.warn('[sw] skipped', url, err))
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const replaced = names.filter(n => n !== CACHE);
    await Promise.all(replaced.map(n => caches.delete(n)));
    await self.clients.claim();

    // Claiming makes this worker control the open pages, but those pages are
    // still running the OLD build's JavaScript until they reload. That is how a
    // phone keeps showing a screen that no longer exists in the source. Tell
    // them to reload once; the page guards against doing it more than once.
    if (replaced.length) {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) client.postMessage({ type: 'sw-updated', version: CACHE });
    }
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never cache Supabase — the sync engine owns freshness, and stale API
  // responses would silently resurrect deleted rows.
  if (url.origin !== self.location.origin) return;

  // Navigations: always try the network first so a deploy is picked up promptly,
  // fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        (await caches.open(CACHE)).put('index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // Code (JS/CSS) is network-first when online, cache only as the offline
  // fallback. Cache-first was serving the previous build's modules for a whole
  // page load while quietly refreshing behind them, which meant a deploy needed
  // two reloads and a fix could appear to be missing when it wasn't. Correctness
  // beats shaving a few milliseconds off a warm start; offline still works,
  // because the cache is right there when the fetch fails.
  if (/\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    })());
    return;
  }

  // Static assets (icons, images): cache-first, refreshed in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    const network = fetch(request)
      .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
      .catch(() => null);
    return hit || (await network) || Response.error();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
