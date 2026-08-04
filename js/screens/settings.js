import { el } from '../ui/dom.js';
import { VERSION, backend, setBackend, isConfigured } from '../core/config.js';
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
import * as idb from '../core/idb.js';
import { toast, errorToast } from '../ui/toast.js';
import { confirmSheet } from '../ui/sheet.js';
import { go } from '../core/router.js';
import { mountInstall } from '../ui/install.js';
import { isInstalled as installed, mode as installMode } from '../core/install.js';
import * as updates from '../core/updates.js';

const MODE_LABEL = {
  open:  'Shared household',
  cloud: 'Shared household',
  local: 'This phone only',
};

const INSTALL_LABEL = {
  installed:   'Installed app',
  prompt:      'Browser tab',
  menu:        'Browser tab',
  ios:         'Browser tab',
  unavailable: 'Browser tab',
};

// Anything not installed is a browser tab, so an unmapped mode still reads right.
const installLabel = () => INSTALL_LABEL[installMode()] ?? 'Browser tab';

export default async function settings() {
  const dev = auth.device();
  const { pending, lastSync } = await sync.status();
  const b = backend();

  const nameField = el('input', { class: 'field', type: 'text', value: dev.name, placeholder: 'Your name' });
  const urlField = el('input', {
    class: 'field', type: 'url', value: b.url,
    placeholder: 'https://xxxx.supabase.co', autocapitalize: 'off', spellcheck: false,
  });
  const keyField = el('input', {
    class: 'field', type: 'text', value: b.anonKey,
    placeholder: 'anon public key', autocapitalize: 'off', spellcheck: false,
  });

  const installSlot = el('div', { class: 'stack-sm' });
  mountInstall(installSlot, { className: 'btn btn-primary btn-block' });

  const waiting = updates.pending();
  const updateStatus = el('p', {
    class: 'help',
    text: waiting ? `Version ${waiting} is ready to install.` : 'Checked when the app opens.',
  });
  const setStatus = message => { updateStatus.textContent = message; };

  return el('div', { class: 'stack' }, [
    installed() ? null : el('div', {}, [
      el('div', { class: 'section-title', text: 'Install' }),
      el('div', { class: 'card stack-sm' }, [
        el('p', { class: 'help', text:
          'Installing puts it on your home screen and runs it full screen, without ' +
          'the browser bars. It works offline either way.' }),
        installSlot,
      ]),
    ]),

    el('div', { class: 'section-title', text: 'This device' }),
    el('div', { class: 'card stack-sm' }, [
      kv('Running as', installLabel()),
      el('label', { class: 'field-label', text: 'Name shown in history' }),
      nameField,
      el('button', {
        class: 'btn btn-primary btn-block',
        text: 'Save name',
        onclick: async () => {
          await auth.setDeviceName(nameField.value);
          const { memberRepo } = await import('../data/members.js');
          await memberRepo.upsertSelf(auth.device());
          toast('Name saved');
        },
      }),
    ]),

    el('div', { class: 'section-title', text: 'Sync' }),
    el('div', { class: 'card stack-sm' }, [
      kv('Mode', MODE_LABEL[auth.mode()] ?? 'This phone only'),
      kv('Last sync', lastSync ? new Date(lastSync).toLocaleString() : 'Never'),
      kv('Waiting to send', String(pending)),
      // A feature can ship before its migration is run. Say so plainly rather
      // than leaving writes queued behind a silent 404.
      sync.pendingMigrations().length ? el('p', { class: 'help warn-text', text:
        `The database is missing ${sync.pendingMigrations().join(' and ')}. `
        + 'Run the matching file in supabase/ from the Supabase SQL editor — '
        + 'nothing is lost meanwhile, those changes are held on this phone.' }) : null,
      el('button', {
        class: 'btn btn-block',
        text: 'Sync now',
        onclick: async () => { await sync.sync(); toast('Sync finished'); },
      }),
    ]),

    el('div', { class: 'section-title', text: 'Supabase project' }),
    el('div', { class: 'card stack-sm' }, [
      el('p', { class: 'help', text:
        'Already set up for this household — you only need this to point the app at a ' +
        'different Supabase project. Changing it signs this phone out.' }),
      el('label', { class: 'field-label', text: 'Project URL' }),
      urlField,
      el('label', { class: 'field-label', text: 'Publishable key' }),
      keyField,
      el('button', {
        class: 'btn btn-block',
        text: isConfigured() ? 'Update connection' : 'Connect',
        onclick: async () => {
          const url = urlField.value.trim().replace(/\/+$/, '');
          const key = keyField.value.trim();
          if (!url || !key) return errorToast('Both the URL and the key are required.');

          // Pressing this with the existing values used to sign the user out and
          // dump them back at the gate for no reason. Only act on a real change.
          if (url === b.url.replace(/\/+$/, '') && key === b.anonKey) {
            return toast('Already connected to that project — nothing changed.');
          }

          const ok = await confirmSheet({
            title: 'Point at a different project?',
            message: 'This signs this phone out and reloads. Anything not yet synced stays queued on this phone.',
            confirmLabel: 'Change project',
            danger: true,
          });
          if (!ok) return;

          setBackend({ url, anonKey: key });
          auth.lock();
          location.reload();
        },
      }),
    ]),

    el('div', { class: 'section-title', text: 'Danger zone' }),
    el('div', { class: 'card stack-sm' }, [
      el('button', {
        class: 'btn btn-block',
        text: 'Re-download everything',
        onclick: async () => {
          await sync.resetCursors();
          await sync.sync();
          toast('Refreshed from the server');
        },
      }),
      // Only meaningful when there's a session to end. In open-access mode there
      // is no sign-in, so this would just bounce the user to the gate to retype
      // their name for no reason.
      auth.mode() !== 'cloud' ? null : el('button', {
        class: 'btn btn-danger btn-block',
        text: 'Sign out of this household',
        onclick: async () => {
          const ok = await confirmSheet({
            title: 'Sign out?',
            message: pending
              ? `${pending} change${pending === 1 ? '' : 's'} still need to reach the server. Signing out keeps them queued on this phone.`
              : 'You will need the household passphrase to get back in.',
            confirmLabel: 'Sign out',
            danger: true,
          });
          if (!ok) return;
          auth.lock();
          location.reload();
        },
      }),
      el('button', {
        class: 'btn btn-danger btn-block',
        text: 'Erase local copy',
        onclick: async () => {
          const ok = await confirmSheet({
            title: 'Erase this phone’s copy?',
            message: 'Anything already synced stays on the server and comes back. Anything still queued is lost.',
            confirmLabel: 'Erase',
            danger: true,
          });
          if (!ok) return;
          await idb.clearAll();
          await sync.resetCursors();
          go('/home', { replace: true });
          location.reload();
        },
      }),
    ]),

    el('div', { class: 'section-title', text: 'App version' }),
    el('div', { class: 'card stack-sm' }, [
      kv('Installed', VERSION),
      updateStatus,
      el('button', {
        class: 'btn btn-block',
        text: 'Check for updates',
        onclick: async function () {
          this.disabled = true;
          const before = this.textContent;
          this.textContent = 'Checking…';
          const result = await updates.check(true);
          this.disabled = false;
          this.textContent = before;

          if (result.status === 'update') {
            setStatus(`Version ${result.version} is ready — use the bar at the top.`);
            toast(`Version ${result.version} is ready`);
          } else if (result.status === 'offline') {
            setStatus('Offline — cannot check right now.');
          } else if (result.status === 'error') {
            setStatus(`Could not check: ${result.message}`);
          } else {
            setStatus('You are on the latest version.');
            toast('Already up to date');
          }
        },
      }),
      el('button', {
        class: 'btn btn-block',
        text: 'Force reinstall this version',
        onclick: async () => {
          const ok = await confirmSheet({
            title: 'Reinstall the app files?',
            message: 'Clears the cached copy and re-downloads it. Your data is untouched.',
            confirmLabel: 'Reinstall',
          });
          if (ok) await updates.apply();
        },
      }),
    ]),
  ]);
}

function kv(label, value) {
  return el('div', { class: 'kv' }, [
    el('span', { class: 'kv-label', text: label }),
    el('span', { class: 'kv-value', text: value }),
  ]);
}
