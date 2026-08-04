// Boot: register the service worker, gate on the household passphrase, wire the
// router and the sync engine, then get out of the way.

import { VERSION, isConfigured, REQUIRE_PASSPHRASE } from './core/config.js';
import * as auth from './core/auth.js';
import * as router from './core/router.js';
import * as sync from './core/sync.js';
import * as updates from './core/updates.js';
import * as idb from './core/idb.js';
import { on, EVENTS } from './core/bus.js';
import { errorToast } from './ui/toast.js';
import { mountInstall } from './ui/install.js';

const gate = document.getElementById('gate');
const app = document.getElementById('app');
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');
const syncDot = document.getElementById('sync-dot');

/* ---- Routes ---- */

const TITLES = {
  '/home': 'Home',
  '/inventory': 'Inventory',
  '/locations': 'Places',
  '/scan': 'Scan',
  '/shopping': 'Shopping',
  '/home-info': 'My House',
  '/measurements': 'Measurements',
  '/measurement': 'Measurement',
  '/maintenance': 'Maintenance',
  '/projects': 'Projects',
  '/project': 'Project',
  '/settings': 'Settings',
  '/quick': 'Quick log',
  '/activity': 'Activity',
  '/search': 'Search',
  '/labels': 'QR labels',
  '/l': 'Place',
  '/item': 'Item',
};

const TABS = ['home', 'inventory', 'scan', 'shopping', 'home-info'];

function defineRoutes() {
  router.define('/home', () => import('./screens/home.js'));
  router.define('/home-info', () => import('./screens/home-info.js'));
  router.define('/settings', () => import('./screens/settings.js'));

  router.define('/locations', () => import('./screens/locations.js'));
  router.define('/labels',    () => import('./screens/labels.js'));
  // Scanning a bin's QR code lands here.
  router.define('/l/:slug',   () => import('./screens/location.js'));

  router.define('/inventory', () => import('./screens/inventory.js'));
  router.define('/item/:id',  () => import('./screens/item.js'));

  router.define('/scan', () => import('./screens/scan.js'));

  router.define('/shopping', () => import('./screens/shopping.js'));

  router.define('/measurements',   () => import('./screens/measurements.js'));
  router.define('/measurement/:id',() => import('./screens/measurement.js'));

  router.define('/maintenance', () => import('./screens/maintenance.js'));
  router.define('/quick',       () => import('./screens/quick.js'));
  router.define('/activity',    () => import('./screens/activity.js'));
  router.define('/search',      () => import('./screens/search.js'));
  router.define('/projects',    () => import('./screens/projects.js'));
  router.define('/project/:id', () => import('./screens/project.js'));
}

function onRouteChange({ path }) {
  const base = '/' + path.split('/')[1];
  titleEl.textContent = TITLES[path] || TITLES[base] || 'Home';

  const isTab = TABS.includes(base.slice(1));
  backBtn.hidden = isTab;

  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.tab === base.slice(1);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

/* ---- Gate ---- */

function showGate() {
  app.hidden = true;
  gate.hidden = false;

  const form = document.getElementById('gate-form');
  const nameEl = document.getElementById('gate-name');
  const passEl = document.getElementById('gate-pass');
  const errEl = document.getElementById('gate-error');
  const offlineBtn = document.getElementById('gate-offline');

  nameEl.value = auth.device().name === 'Me' ? '' : auth.device().name;
  mountInstall(document.getElementById('gate-install'), { className: 'btn btn-block' });

  // Which build is this phone actually running? Answers the first question of
  // every "it isn't working" conversation.
  document.getElementById('gate-version').textContent =
    `Version ${VERSION} · ${isConfigured() ? 'shared household' : 'local only'}`;

  // Three shapes of gate, decided here so the submit path stays simple:
  //   no project      -> name only, this phone only
  //   open access     -> name only, straight into the shared database
  //   passphrase build-> name + passphrase
  const needsPassphrase = isConfigured() && REQUIRE_PASSPHRASE;
  const sub = document.querySelector('.gate-sub');
  const btn = document.getElementById('gate-submit');

  if (!isConfigured()) {
    passEl.hidden = true;
    sub.textContent = 'No Supabase project is connected yet. Start on this phone — '
      + 'you can connect the household later in Settings.';
  } else if (!needsPassphrase) {
    passEl.hidden = true;
    sub.textContent = 'Enter your name and you’re in. Everyone in the house shares the same list.';
    btn.textContent = 'Start';
    offlineBtn.hidden = true;
  }

  const fail = message => {
    errEl.textContent = message;
    errEl.hidden = false;
  };

  const submit = async () => {
    if (btn.disabled) return;
    errEl.hidden = true;

    const name = nameEl.value.trim();
    if (!name) return fail('Enter your name so the household knows who did what.');
    if (needsPassphrase && !passEl.value) return fail('Enter the household passphrase.');

    const restore = btn.textContent;
    btn.disabled = true;
    btn.textContent = needsPassphrase ? 'Unlocking…' : 'Starting…';
    try {
      if (needsPassphrase) await withTimeout(auth.unlockCloud(passEl.value, name), 20_000);
      else if (isConfigured()) await withTimeout(auth.unlockOpen(name), 20_000);
      else auth.unlockLocal(name);
      await startApp();
    } catch (err) {
      console.error('[gate]', err);
      fail(friendly(err?.message || String(err)));
    } finally {
      btn.disabled = false;
      btn.textContent = restore;
    }
  };

  form.onsubmit = e => { e.preventDefault(); submit(); };
  // Belt and braces: if the form's submit event is ever swallowed, the button
  // still works. submit() guards against running twice.
  btn.onclick = e => { e.preventDefault(); submit(); };

  offlineBtn.onclick = async () => {
    auth.unlockLocal(nameEl.value || 'Me');
    await startApp();
  };
}

/** Never let a request hang silently — a spinner that never stops reads as "broken". */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timed out reaching Supabase.')), ms)),
  ]);
}

function friendly(message) {
  if (/invalid login|invalid grant|credentials/i.test(message)) {
    return 'That passphrase does not match the household account.';
  }
  if (/email not confirmed|not confirmed/i.test(message)) {
    return 'The household account exists but is unconfirmed. In Supabase → Authentication → Users, confirm it.';
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Could not reach Supabase. Check your connection and try again.';
  }
  if (/timed out/i.test(message)) return 'Timed out reaching Supabase. Try again.';
  return message;
}

/* ---- App ---- */

async function startApp() {
  gate.hidden = true;
  app.hidden = false;

  await idb.open();
  defineRoutes();
  await router.start(view, onRouteChange);

  backBtn.onclick = () => router.back();
  document.getElementById('settings-btn').onclick = () => router.go('/settings');

  on(EVENTS.SYNC_STATE, state => { syncDot.dataset.state = state; });
  syncDot.onclick = () => showSyncStatus();
  // Only repaint for changes that arrived from another device. A local write
  // already updated whatever made it, and re-rendering mid-interaction would
  // replace the control under the user's finger — the stepper especially.
  on(EVENTS.DATA_CHANGED, detail => {
    if (detail?.source === 'sync') router.refresh();
  });

  wireUpdateBar();
  sync.start();
  updates.start();
}

const SYNC_MEANING = {
  synced:  ['Up to date', 'Everything on this phone matches the household database.'],
  syncing: ['Syncing now', 'Sending and fetching changes.'],
  offline: ['Offline', 'Changes are saved on this phone and will go up when you are back on the network.'],
  error:   ['Could not sync', 'Something went wrong reaching the database. Nothing is lost — it will try again.'],
  local:   ['This phone only', 'Not connected to the shared household database.'],
};

/** The dot is a colour; this is what it means, in words. */
async function showSyncStatus() {
  const [{ sheet, close }, { el }] = await Promise.all([
    import('./ui/sheet.js'), import('./ui/dom.js'),
  ]);
  const state = syncDot.dataset.state || 'local';
  const [title, body] = SYNC_MEANING[state] ?? SYNC_MEANING.local;
  const { pending, lastSync } = await sync.status();
  const missing = sync.pendingMigrations();

  sheet({
    title,
    body: el('div', { class: 'stack-sm' }, [
      el('p', { class: 'help', text: body }),
      el('div', { class: 'kv' }, [
        el('span', { class: 'kv-label', text: 'Last sync' }),
        el('span', { class: 'kv-value', text: lastSync ? new Date(lastSync).toLocaleString() : 'Never' }),
      ]),
      el('div', { class: 'kv' }, [
        el('span', { class: 'kv-label', text: 'Waiting to send' }),
        el('span', { class: 'kv-value', text: String(pending) }),
      ]),
      missing.length ? el('p', { class: 'help warn-text', text:
        `The database is missing ${missing.join(' and ')} — run the matching file in supabase/.` }) : null,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Close', onclick: () => close() }),
      el('button', {
        class: 'btn btn-primary btn-block', text: 'Sync now',
        onclick: async () => { close(); await sync.sync(); },
      }),
    ],
  });
}

function wireUpdateBar() {
  const bar = document.getElementById('update-bar');
  const text = document.getElementById('update-text');
  const button = document.getElementById('update-btn');

  const render = version => {
    bar.hidden = !version;
    if (version) text.textContent = `Version ${version} is ready`;
  };

  button.onclick = async () => {
    button.disabled = true;
    button.textContent = 'Updating…';
    await updates.apply();
  };

  updates.onChange(render);
  render(updates.pending());
}

/* ---- Service worker ---- */

/**
 * A freshly activated worker controls this page, but the page is still running
 * the previous build's modules until it reloads — which is how a phone keeps
 * showing screens that no longer exist in the source. Reload once, guarded by a
 * session flag so a misbehaving worker cannot put us in a reload loop.
 */
function listenForWorkerUpdates() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'sw-updated') return;
    if (sessionStorage.getItem('gi.reloadedFor') === event.data.version) return;
    sessionStorage.setItem('gi.reloadedFor', event.data.version);
    console.info('[app] new build activated, reloading once');
    location.reload();
  });
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  listenForWorkerUpdates();
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', function () {
        if (this.state === 'installed' && navigator.serviceWorker.controller) {
          console.info(`[app] update ready (running ${VERSION})`);
        }
      });
    });
  } catch (err) {
    console.warn('[app] service worker registration failed', err);
  }
}

window.addEventListener('unhandledrejection', e => {
  console.error('[app]', e.reason);
  if (!gate.hidden) return;
  errorToast(e.reason?.message || 'Something went wrong');
});

/** Drop the ?v= cache-buster an update leaves behind, without another navigation. */
function tidyUrl() {
  if (!location.search.includes('v=')) return;
  const url = new URL(location.href);
  url.searchParams.delete('v');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

(async function boot() {
  tidyUrl();
  await registerSW();

  if (auth.isUnlocked()) return startApp();

  // Open access has nothing to ask for, so don't ask. Walk straight into the
  // app; the name is set later on the Settings page, or from the prompt on Home.
  if (isConfigured() && !REQUIRE_PASSPHRASE) {
    try {
      await auth.unlockOpen(auth.device().name);
    } catch (err) {
      console.warn('[boot] could not join the shared database', err);
      auth.unlockLocal(auth.device().name);
    }
    return startApp();
  }

  showGate();
})();
