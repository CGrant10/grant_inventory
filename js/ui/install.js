// The install affordance. One component, three states, used by the gate and
// by Settings so they can never drift apart.

import { el, icon } from './dom.js';
import { sheet, close } from './sheet.js';
import { toast } from './toast.js';
import * as install from '../core/install.js';

const DOWNLOAD = '<path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 20h16"/>';
const SHARE_IOS = '<path d="M12 3v12"/><path d="M8.5 6.5L12 3l3.5 3.5"/><rect x="5" y="10" width="14" height="11" rx="2"/>';

/**
 * Returns a button, or null when there's nothing useful to offer (already
 * installed, or a browser with no install path at all).
 *
 * @param {object}  opts
 * @param {string}  opts.className  button classes
 * @param {boolean} opts.compact    shorter label, for tight spots
 */
export function installButton({ className = 'btn btn-block', compact = false } = {}) {
  const state = install.mode();
  if (state === 'installed' || state === 'unavailable') return null;

  const label = compact ? 'Install' : 'Install on this phone';
  const glyph = state === 'ios' ? SHARE_IOS : DOWNLOAD;

  const button = el('button', {
    class: className,
    type: 'button',
    onclick: () => {
      if (state === 'ios') return showIOSSteps();
      if (state === 'menu') return showMenuSteps();
      return run(button);
    },
  }, [icon(glyph, 20), el('span', { text: label })]);

  return button;
}

async function run(button) {
  button.disabled = true;
  const outcome = await install.promptInstall();
  button.disabled = false;

  if (outcome === 'accepted') toast('Installed. Look for it on your home screen.');
  else if (outcome === 'unavailable') showMenuSteps();
  // On 'dismissed' the button re-renders into its 'menu' state, which explains
  // the browser-menu route — the prompt event is spent and won't come back.
}

/** iOS has no install API, so the honest answer is instructions. */
function showIOSSteps() {
  sheet({
    title: 'Add to your home screen',
    body: el('div', { class: 'steps' }, [
      step(1, 'Tap the Share button at the bottom of Safari.'),
      step(2, 'Scroll down and tap “Add to Home Screen”.'),
      step(3, 'Tap “Add”. It opens full screen, like a normal app.'),
      el('p', { class: 'help', text:
        'Safari is the only browser on iPhone that can do this — Chrome on iOS cannot.' }),
    ]),
    actions: [el('button', { class: 'btn btn-primary btn-block', text: 'Got it', onclick: () => close() })],
  });
}

/** The prompt is spent for this page view, so send them to the browser menu. */
function showMenuSteps() {
  sheet({
    title: 'Install from the menu',
    body: el('div', { class: 'steps' }, [
      step(1, 'Open your browser’s menu — the ⋮ or ••• button.'),
      step(2, 'Tap “Install app” or “Add to Home screen”.'),
      el('p', { class: 'help', text:
        'The one-tap install offer only appears once per visit. Reloading the page brings it back.' }),
    ]),
    actions: [el('button', { class: 'btn btn-primary btn-block', text: 'Got it', onclick: () => close() })],
  });
}

function step(n, text) {
  return el('div', { class: 'step' }, [
    el('span', { class: 'step-n', text: String(n) }),
    el('span', { text }),
  ]);
}

/** Keep a container's button in sync as installability changes. */
export function mountInstall(container, opts) {
  const render = () => {
    container.replaceChildren();
    const button = installButton(opts);
    container.hidden = !button;
    if (button) container.append(button);
  };
  render();
  return install.onChange(render);
}
