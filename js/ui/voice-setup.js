// Voice and home-screen shortcut setup.
//
// The honest state of play, which the UI says out loud rather than burying:
//   iPhone  — Siri Shortcuts can open a URL, so a real spoken phrase works, free.
//   Android — Google shut down custom Assistant actions in 2023 and Home
//             routines cannot call a webhook, so a free spoken phrase is not
//             possible. A home-screen icon is one tap, which is the next best
//             thing and works for everyone.

import { el, icon, ICONS } from './dom.js';
import { sheet, close } from './sheet.js';
import { toast } from './toast.js';
import { itemRepo } from '../data/items.js';

function appBase() {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/[^/]*$/, '');
}

export function quickUrl(name, action = 'use') {
  return `${appBase()}#/quick?${action}=${encodeURIComponent(name)}`;
}

export async function voiceSetup() {
  const items = (await itemRepo.all()).sort((a, b) => a.name.localeCompare(b.name));

  const picker = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'Pick an item…' }),
    ...items.map(i => el('option', { value: i.name, text: i.name })),
  ]);

  const action = el('select', { class: 'field' }, [
    el('option', { value: 'use', text: 'Took one' }),
    el('option', { value: 'add', text: 'Put one back' }),
  ]);

  const output = el('input', {
    class: 'field selectable', type: 'text', readonly: true,
    value: `${appBase()}#/quick`,
  });

  const update = () => {
    output.value = picker.value ? quickUrl(picker.value, action.value) : `${appBase()}#/quick`;
  };
  picker.addEventListener('change', update);
  action.addEventListener('change', update);

  const copy = el('button', {
    class: 'btn btn-primary btn-block',
    text: 'Copy link',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(output.value);
        toast('Link copied');
      } catch {
        // Clipboard access is refused in some in-app browsers; selecting the
        // text is a workable fallback rather than a dead button.
        output.select();
        toast('Press and hold the link to copy it');
      }
    },
  });

  sheet({
    title: 'Quick and voice shortcuts',
    body: el('div', { class: 'stack-sm' }, [
      el('p', { class: 'help', text:
        'Every quick action is just a link. Anything that can open a link can log '
        + 'a banana — a home-screen icon, a Siri phrase, a widget.' }),

      el('label', { class: 'field-label', text: 'Build a link' }),
      picker,
      action,
      output,
      copy,

      el('div', { class: 'section-title', text: 'Everyone — one tap from the home screen' }),
      el('div', { class: 'steps' }, [
        step(1, 'Copy the link above (or leave it on “Pick an item…” for the quick screen itself).'),
        step(2, 'Open it in your phone’s browser.'),
        step(3, 'Share → Add to Home Screen. Name it “Banana” or just “Used”.'),
        step(4, 'Tapping that icon logs it. No app to open, no menus.'),
      ]),

      el('div', { class: 'section-title', text: 'iPhone — actual voice' }),
      el('div', { class: 'steps' }, [
        step(1, 'Open the Shortcuts app → + → Add Action → Web → Open URLs.'),
        step(2, 'Paste the link.'),
        step(3, 'Rename the shortcut to what you want to say — “Took a banana”.'),
        step(4, 'Say “Hey Siri, took a banana”. It opens the app and logs it.'),
      ]),

      el('div', { class: 'section-title', text: 'Android and Google Home' }),
      el('p', { class: 'help', text:
        'A custom spoken phrase is not possible for free. Google retired custom '
        + 'Assistant actions in 2023, and Home routines cannot call a web address. '
        + 'The paid routes are IFTTT Pro or Tasker. The home-screen icon above is '
        + 'free, one tap, and works on every phone in the house — including hers.' }),
    ]),
    actions: [el('button', { class: 'btn btn-block', text: 'Done', onclick: () => close() })],
  });
}

function step(n, text) {
  return el('div', { class: 'step' }, [
    el('span', { class: 'step-n', text: String(n) }),
    el('span', { text }),
  ]);
}
