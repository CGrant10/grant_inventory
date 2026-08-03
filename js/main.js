// Boot: register the service worker, gate on the household passphrase, wire the
// router and the sync engine, then get out of the way.

import { VERSION, isConfigured } from './core/config.js';
import * as auth from './core/auth.js';
import * as router from './core/router.js';
import * as sync from './core/sync.js';
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
  '/projects': 'Projects',
  '/settings': 'Settings',
  '/l': 'Place',
  '/item': 'Item',
};

const TABS = ['home', 'inventory', 'scan', 'shopping', 'home-info'];

function defineRoutes() {
  router.define('/home', () => import('./screens/home.js'));
  router.define('/home-info', () => import('./screens/home-info.js'));
  router.define('/settings', () => import('./screens/settings.js'));

  const later = () => import('./screens/placeholder.js');
  router.define('/inventory',   async () => ({ default: (await later()).inventory }));
  router.define('/locations',   async () => ({ default: (await later()).locations }));
  router.define('/scan',        async () => ({ default: (await later()).scan }));
  router.define('/shopping',    async () => ({ default: (await later()).shopping }));
  router.define('/measurements',async () => ({ default: (await later()).measurements }));
  router.define('/projects',    async () => ({ default: (await later()).projects }));

  // Scanning a bin's QR code lands here.
  router.define('/l/:slug',     async () => ({ default: (await later()).locations }));
  router.define('/item/:id',    async () => ({ default: (await later()).inventory }));
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

  if (!isConfigured()) {
    passEl.hidden = true;
    passEl.required = false;
    document.querySelector('.gate-sub').textContent =
      'No Supabase project is connected yet. Start on this phone — you can connect the household later in Settings.';
  }

  form.onsubmit = async e => {
    e.preventDefault();
    errEl.hidden = true;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      if (isConfigured()) await auth.unlockCloud(passEl.value, nameEl.value);
      else auth.unlockLocal(nameEl.value);
      await startApp();
    } catch (err) {
      errEl.textContent = friendly(err.message);
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };

  offlineBtn.onclick = async () => {
    auth.unlockLocal(nameEl.value || 'Me');
    await startApp();
  };
}

function friendly(message) {
  if (/invalid login|invalid grant|credentials/i.test(message)) return 'That passphrase does not match.';
  if (/failed to fetch|networkerror/i.test(message)) return 'Could not reach Supabase. Check the connection and try again.';
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
  on(EVENTS.DATA_CHANGED, () => router.refresh());

  sync.start();
}

/* ---- Service worker ---- */

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
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

(async function boot() {
  await registerSW();
  if (auth.isUnlocked()) await startApp();
  else showGate();
})();
