// Build identity and backend wiring.
//
// VERSION must match version.txt and the cache string in sw.js. All three move
// together on every commit or the in-app update check breaks.
export const VERSION = '0.1.0';

// Supabase project. Leave blank to ship a local-only build — the app still works
// on one phone and Settings offers a "Connect" form that stores these locally.
// The anon key is public by design; row-level security is what protects the data.
const BUILT_IN = {
  url:     '',
  anonKey: '',
};

// The single household account. The "passphrase" is this account's password.
export const HOUSEHOLD_EMAIL = 'household@grant-inventory.local';

const OVERRIDE_KEY = 'gi.backend';

export function backend() {
  try {
    const saved = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || 'null');
    if (saved?.url && saved?.anonKey) return saved;
  } catch { /* fall through to built-in */ }
  return BUILT_IN;
}

export function setBackend({ url, anonKey }) {
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify({
    url: String(url || '').replace(/\/+$/, ''),
    anonKey: String(anonKey || '').trim(),
  }));
}

export function isConfigured() {
  const b = backend();
  return Boolean(b.url && b.anonKey);
}

// How often to pull while the app is open and visible.
export const PULL_INTERVAL_MS = 45_000;
