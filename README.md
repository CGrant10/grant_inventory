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

## Appearance

Settings → Appearance is System, Light or Dark. "System" stores nothing and lets
the media query in `css/tokens.css` answer, so a phone that switches at sunset
takes the app with it; the other two set `data-theme` on `<html>` and win outright.

The choice is applied twice on purpose. An inline script in `index.html` sets the
attribute before the first paint — a module is deferred until after the document
is parsed, so without it a phone set to Light with the app set to Dark flashes a
full cream screen on every cold start. `js/core/theme.js` then takes over and keeps
the `theme-color` meta in step by reading whatever `--bg` actually resolved to, so
the browser chrome can never disagree with the screen.

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
URL anything can call), **receipts and warranties**, **insights** — spending by
month and by shop, what gets used most, and what is on course to run out — and
**photos** on items, places, measurements, projects and receipts.

## Filling the house

The first pass through a house is a different job from adding the thing you just
bought, so it has its own two shapes:

- **Save & another** on the new-item sheet keeps the sheet open and keeps the
  place, unit and category, clearing only the name. Enter does the same, so a
  tote is typed rather than tapped through.
- **Add several at once** — on a place, or at the foot of the inventory — takes
  a list, one item per line, `Name, qty, unit`. Commas and tabs both separate,
  so a dictated list and a pasted spreadsheet column both work. Nothing is
  created until every line parses: a half-imported tote is worse than a rejected
  one, because the only way to audit it is to read it back by hand.

The inventory list stacks either A–Z or **by place** — the toggle at the end of
the filter chips. That is a reading preference rather than somewhere you
navigated to, so it lives in `localStorage` and not in the URL.

## Going back, and getting out

Every history entry is stamped with a number in `history.state`, and the scroll
position it was left at is kept against that number. Back from an item returns
to the row you tapped, not to the top of three hundred. The number has to be the
key rather than the path: two entries for `#/locations` are different places, and
one of them may well be somewhere you have never scrolled.

Sheets are draggable. A drag starts on the grip — which has always looked like a
handle and until now was not one — or anywhere in content already scrolled to the
top; never in a field, or a textarea could not be swiped through. Past 28% of the
sheet's own height, or on a flick, it dismisses; anything less springs back.
Velocity is measured over the last movement rather than the whole gesture, so
dragging a sheet down to read what is underneath and then letting go does not
count as throwing it away.

While a sheet is up the rest of the app is `inert`: not tabbable, not clickable,
not read out. Tab cycles inside the panel, and closing puts focus back on
whatever opened it — or on the view, if that button no longer exists because the
save rebuilt the screen behind it.

## Photos

Every photo is shrunk to fit inside 1600px and re-encoded as JPEG before it is
sent: a 12-megapixel phone photo is about 4 MB, and the same picture at 1600px is
about 250 KB. That is the difference between 250 photos and 4,000 in the free
tier's 1 GB.

Capture never waits for the network. The blob is written to IndexedDB and the
`attachments` row to the outbox, and the upload happens on the next sync — or
whenever the phone next has signal. Settings → Photos says how many are still
only on one phone.

Every photo the phone downloads is kept in the same store, so it is fetched once
rather than once per look. Egress (5 GB/month) is scarcer than storage, and that
cache is what protects it.

Deleting a photo is a soft delete, like everything else: the row is tombstoned so
every phone drops it, but the file stays in the bucket — anon has no delete
permission on storage, deliberately, so a passer-by cannot wipe the household's
photos. Reclaiming that space is a job for the Supabase dashboard.

Adding one is always the same shape: a table in `js/core/model.js`, a repository
in `js/data/`, a screen, and a migration in `supabase/`. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
