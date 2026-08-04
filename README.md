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
3. Run the per-feature migrations, which are separate files and safe to re-run:
   `supabase/maintenance.sql` and `supabase/purchases.sql`.

   Until a migration is run the app still works — writes to that table stay
   queued on the phone and the sync sheet says which file is missing — but
   nothing syncs to the household until it is.
4. **Authentication → Users → Add user**: email `household@grant-inventory.local`,
   password = the household passphrase, and tick *Auto Confirm User*.
5. **Project Settings → API**: copy the project URL and the `anon` public key.

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

All eight build phases from the architecture doc are shipped:

| | |
|---|---|
| Foundation | shell, service worker, router, IndexedDB mirror, sync engine |
| Places | tree of rooms and bins, QR codes, printable label sheets |
| Inventory | items, quantities as events, categories, full history |
| Scanning | barcodes, Open Food Facts lookup, scan-to-open a bin |
| Low stock | minimums, an automatic shopping list, buy → restock in one tap |
| Measurements | dimension sets per room, window, door or appliance |
| Projects | status board, materials pulled from stock, cost roll-up |
| Polish | activity feed, search across everything, expiry warnings |

Since then: household **maintenance** on a cycle, **quick log** (one tap, and a
URL anything can call), **receipts and warranties**, and **insights** — spending
by month and by shop, what gets used most, and what is on course to run out.

Not built yet: **photos**. The `attachments` table, the storage bucket and its
policies all exist; nothing writes to them. That is the next real feature, and
receipt images are waiting on it.

Adding one is always the same shape: a table in `js/core/model.js`, a repository
in `js/data/`, a screen, and a migration in `supabase/`. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
