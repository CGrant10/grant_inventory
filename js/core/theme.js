// Appearance: follow the phone, or don't.
//
// tokens.css has carried a full light palette and both `[data-theme]` overrides
// since the first release, and nothing ever set the attribute — so the app has
// only ever done what the operating system told it. This is the switch.
//
// The choice is applied twice: once by an inline script in index.html before the
// first paint, and once here. The inline copy is what stops a dark-mode phone
// flashing a cream screen on every cold start; this copy is what keeps it in step
// afterwards.

export const STORAGE_KEY = 'gi.theme';

export const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'light',  label: 'Light' },
  { id: 'dark',   label: 'Dark' },
];

/**
 * Which palette a preference actually means.
 *
 * Pure, and takes the system's answer as an argument, so the interesting case —
 * "system" resolving differently on two phones — can be tested.
 */
export function resolve(preference, systemPrefersDark) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

const darkQuery = () => matchMedia('(prefers-color-scheme: dark)');

export function preference() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return THEMES.some(t => t.id === saved) ? saved : 'system';
}

export function resolved() {
  return resolve(preference(), darkQuery().matches);
}

export function set(next) {
  if (next === 'system') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, next);
  apply();
}

function apply() {
  const pref = preference();
  const root = document.documentElement;

  // "system" means no attribute at all, so the media query in tokens.css is left
  // to answer — including when the phone changes its mind at sunset.
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;

  paintStatusBar();
}

/**
 * Keep the browser chrome the same colour as the app.
 *
 * The two media-based <meta>s in index.html are right until someone overrides
 * the system, at which point they are confidently wrong. Rather than track the
 * palette in two places, this reads whatever `--bg` actually resolved to and
 * hands that to the browser — so the status bar can never disagree with the
 * screen, whatever the tokens say.
 */
function paintStatusBar() {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg').trim();
  if (!bg) return;

  for (const meta of document.querySelectorAll('meta[name="theme-color"][media]')) {
    meta.remove();
  }

  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = bg;
}

export function start() {
  apply();
  // Following the system means following it as it changes, not only at boot.
  darkQuery().addEventListener('change', () => {
    if (preference() === 'system') paintStatusBar();
  });
}
