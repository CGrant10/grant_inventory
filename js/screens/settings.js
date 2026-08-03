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
      kv('Mode', auth.mode() === 'cloud' ? 'Shared household' : 'This phone only'),
      kv('Last sync', lastSync ? new Date(lastSync).toLocaleString() : 'Never'),
      kv('Waiting to send', String(pending)),
      el('button', {
        class: 'btn btn-block',
        text: 'Sync now',
        onclick: async () => { await sync.sync(); toast('Sync finished'); },
      }),
    ]),

    el('div', { class: 'section-title', text: 'Supabase project' }),
    el('div', { class: 'card stack-sm' }, [
      el('p', { class: 'help', text:
        'Paste the project URL and the anon public key from Supabase → Project Settings → API. ' +
        'The anon key is safe to store here; row-level security is what protects the data.' }),
      el('label', { class: 'field-label', text: 'Project URL' }),
      urlField,
      el('label', { class: 'field-label', text: 'Anon key' }),
      keyField,
      el('button', {
        class: 'btn btn-primary btn-block',
        text: isConfigured() ? 'Update connection' : 'Connect',
        onclick: () => {
          if (!urlField.value.trim() || !keyField.value.trim()) {
            return errorToast('Both the URL and the anon key are required.');
          }
          setBackend({ url: urlField.value, anonKey: keyField.value });
          toast('Saved. Sign in with the household passphrase.');
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
      el('button', {
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

    el('p', { class: 'version', text: `Version ${VERSION}` }),
  ]);
}

function kv(label, value) {
  return el('div', { class: 'kv' }, [
    el('span', { class: 'kv-label', text: label }),
    el('span', { class: 'kv-value', text: value }),
  ]);
}
