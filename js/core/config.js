// Build identity and backend wiring.
//
// VERSION must match version.txt and the cache string in sw.js. All three move
// together on every commit or the in-app update check breaks.
export const VERSION = '0.7.1';

// Supabase project. The publishable key is public — it ships in every client
// bundle and the repo is public, so treat it as readable by anyone. What that
// key can actually DO is decided entirely by the RLS policies in supabase/;
// see REQUIRE_PASSPHRASE below.
// Blank these to ship a local-only build; Settings also offers a Connect form.
const BUILT_IN = {
  url:     'https://sznkdnzgoepwkoddrvgg.supabase.co',
  anonKey: 'sb_publishable_pvAFS7cCwXCRMSbm8C2U2Q_r_ai6YUP',
};

// The single household account. The "passphrase" is this account's password.
export const HOUSEHOLD_EMAIL = 'household@grant-inventory.local';

// No sign-in: everyone with the URL shares one database, and the app talks to
// Supabase with the publishable key alone.
//
// This must agree with the policies installed in Postgres:
//   false -> supabase/open-access.sql   (anon can read/write; no delete)
//   true  -> supabase/lock-down.sql     (household passphrase required)
//
// Set one without the other and the app either shows a gate it doesn't need or
// silently fails every request.
export const REQUIRE_PASSPHRASE = false;

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
