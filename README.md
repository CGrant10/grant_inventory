# Grant Household Inventory

A mobile-first PWA for knowing what the household has, how much, where it's stored,
what's running low, and what to buy — plus measurements and project plans for the house.

Static site on GitHub Pages, shared Postgres on Supabase, no build step, no paid services.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Setup

### 1. Supabase

1. Create a free project at supabase.com.
2. **SQL Editor** → run `supabase/schema.sql`, then `supabase/policies.sql`,
   then optionally `supabase/seed.sql`.
3. **Authentication → Users → Add user**: email `household@grant-inventory.local`,
   password = the household passphrase, and tick *Auto Confirm User*.
4. **Project Settings → API**: copy the project URL and the `anon` public key.

### 2. The app

Put the URL and anon key into `js/core/config.js` (`BUILT_IN`) and commit, or paste
them into Settings on each phone. Baking them in is easier for the household —
they're safe to publish, because row-level security requires the passphrase.

### 3. GitHub Pages

**Settings → Pages → Source: Deploy from a branch → `main` / root.**
The app lives at `https://cgrant10.github.io/grant_inventory/`.

### 4. Install on a phone

Open that URL, then *Add to Home Screen*. Enter your name and the household
passphrase once; every phone that does the same sees the same data.

## Local development

Serve the folder over HTTP — service workers and ES modules will not run from `file://`:

```bash
python -m http.server 8080
```

## Access modes

Two settings must agree — the flag in the app and the policies in Postgres:

| Mode | `REQUIRE_PASSPHRASE` | SQL to run | Who can read/write |
|---|---|---|---|
| Open (current) | `false` | `supabase/open-access.sql` | anyone with the URL |
| Passphrase | `true` | `supabase/lock-down.sql` | household account only |

Open mode is a deliberate trade: the publishable key ships in a public bundle from
a public repo, so "no sign-in" means the data is public. Anonymous access is granted
select/insert/update but **not** delete — the app only soft-deletes, so a passer-by
still cannot hard-drop rows.

Set the flag without running the matching SQL and the app either shows a gate it
does not need, or fails every request with `violates row-level security policy`.

## Branding

The badge in `assets/logo-source.png` is the single source for every icon —
`python tools/make_icons.py` regenerates the whole set plus `assets/logo.png`.
The palette in `css/tokens.css` is sampled from it: cream `#faf5f0`, ink `#31312a`,
tan `#ad987e`.

## Versioning

Three things move together on every commit, or phones keep serving the old build:

- `VERSION` in `js/core/config.js`
- `CACHE` in `sw.js`
- `version.txt`

`version.txt` is what the in-app update button compares against. If it lags behind
`VERSION` the button never appears; if it runs ahead, the banner never clears. They
must be identical strings.

## Status

Phase 1 (foundation) is in place: app shell, service worker, design tokens, router,
auth gate, IndexedDB mirror, sync engine, and the database schema.
Phases 2–8 — places and QR labels, inventory, scanning, shopping, measurements,
projects, polish — are laid out in the architecture doc.
