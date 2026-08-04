# Grant Inventory — Architecture

Mobile-first PWA. GitHub Pages (`CGrant10/grant_inventory`) + Supabase free tier.
Local-first, offline-capable, multi-phone sync.

## 1. Guiding decisions

| Decision | Choice | Why |
|---|---|---|
| Hosting | GitHub Pages, repo root | Free, static, already the workflow |
| Backend | Supabase (Postgres + Realtime + Storage) | Relational schema survives years of growth; free tier covers a household |
| Auth | One household account (fixed email + passphrase) | Zero friction; RLS denies everything unauthenticated |
| Build step | **None.** Native ES modules | No toolchain to rot. Deps vendored, not CDN'd (offline + CSP) |
| Data flow | Local-first: IndexedDB is the read path, Supabase is the truth | App is instant and works offline; sync is background |
| Quantity writes | Append-only delta events, never overwrite | Two phones decrementing the same item can't lose a write |
| Extensibility | Polymorphic `attachments`, `jsonb` attributes, event log | New features add rows, not migrations |

## 2. Layers

```
screens/     route-level views (home, scan, inventory, location, shopping, …)
   |
ui/          dumb reusable components (sheet, stepper, list, scanner, toast)
   |
data/        repositories — the ONLY thing screens talk to for data
   |
core/        idb (local mirror), sync (pull/push), supabase client, bus, router, store
   |
Supabase     Postgres + Realtime + Storage
```

Rule: a screen never imports the Supabase client. It calls `itemsRepo.consume(id, 1)`.
The repo writes IndexedDB immediately, queues an outbox op, and returns. UI is never
blocked on the network.

## 3. Sync model

**Pull** — per-table cursor. `select * from t where updated_at > cursor` (soft-deleted
rows included, so tombstones propagate). Realtime subscription just triggers an early pull.

**Push** — an `outbox` store in IndexedDB. Each op is `{id, table, kind, payload, tries}`.
Drained in order on reconnect, idempotent by client-generated UUID.

**Conflicts**
- Scalar fields: last-write-wins by `updated_at`.
- Quantities: never sent as absolutes. `consume`/`restock` push an `item_events` row with
  a `delta`; a Postgres trigger applies it to `items.quantity`. Commutative — order and
  offline lag don't matter.

## 4. Database schema (Postgres)

Every table: `id uuid pk default gen_random_uuid()`, `household_id uuid not null`,
`created_at`, `updated_at` (trigger-maintained), `deleted_at` (soft delete / tombstone).

```
households        id, name
members           household_id, display_name, color          -- device picks one; powers history
categories        household_id, name, icon, color, sort_order

locations         household_id, parent_id -> locations, name, kind, qr_slug unique,
                  notes, sort_order
                  kind: room|area|shelf|cabinet|drawer|fridge|freezer|closet|bin|tote|other
                  Self-referencing tree: Kitchen > Pantry > Shelf 2 > Bin A

products          household_id, barcode, name, brand, default_unit, category_id,
                  image_url, source (off|manual), attributes jsonb
                  unique (household_id, barcode)
                  -- The CATALOG. What a thing is. Not how much you have.

items             household_id, product_id?, name, category_id, location_id,
                  quantity numeric, unit, min_quantity, expires_on, notes
                  -- A STOCK LOT in a place. Same product in pantry + garage = 2 rows.

item_events       household_id, item_id, member_id, type, delta numeric,
                  from_location_id?, to_location_id?, note
                  type: add|consume|restock|adjust|move|discard|expire
                  -- Append-only. Trigger applies delta. Powers history + analytics later.

shopping_items    household_id, product_id?, item_id?, name, quantity, unit,
                  status (needed|in_cart|purchased), auto_generated bool,
                  purchased_at, purchased_by

measurements      household_id, location_id?, name, subject_kind, notes
                  subject_kind: room|window|door|cabinet|appliance|furniture|other
measurement_dims  measurement_id, label, value numeric, unit, sort_order
                  -- "Width 36 in", "Height 84 in" — arbitrary dimension sets

projects          household_id, title, status, priority, description,
                  est_cost, actual_cost, target_date
                  status: idea|planned|active|blocked|done
project_lines     project_id, kind (material|tool|task), name, quantity, unit,
                  est_cost, done bool, item_id?, measurement_id?

attachments       household_id, entity_type, entity_id, storage_path, kind, w, h
                  -- ONE photo table for every entity. New feature = no schema change.
```

**Views**
- `v_low_stock` — items where `quantity <= min_quantity`, joined to product + location
- `v_expiring` — items with `expires_on` inside a window
- `v_location_tree` — recursive CTE giving each location its full path string

**RLS** — every table: `using (auth.role() = 'authenticated')`. The anon key ships in the
bundle (it's designed to); without the household passphrase it reads nothing.
`household_id` is already there so a second household is a policy change, not a migration.

## 5. Project structure

```
grant_inventory/
  index.html
  manifest.json
  sw.js                     app-shell precache + stale-while-revalidate
  version.txt               must equal VERSION in js/core/config.js
  assets/icons/…
  css/
    tokens.css              colors, spacing, type scale, safe-area insets
    base.css  components.css  screens.css
  js/
    main.js                 boot: register SW, auth gate, hydrate, start sync
    core/
      config.js             VERSION, Supabase URL + anon key, feature flags
      supabase.js  idb.js  sync.js  outbox.js  bus.js  router.js  auth.js
    data/
      items.js  locations.js  products.js  shopping.js
      measurements.js  projects.js  attachments.js
    ui/
      sheet.js  list.js  stepper.js  scanner.js  toast.js
      empty-state.js  photo-input.js  qr.js
    screens/
      home.js  scan.js  inventory.js  location.js  item.js
      shopping.js  measurements.js  projects.js  settings.js
    features/
      barcode-lookup.js     Open Food Facts + local product cache
      low-stock.js          min-qty engine -> auto shopping list
      labels.js             printable QR sheet for bins
    vendor/                 supabase-js (ESM), zxing-wasm, qrcode — vendored, not CDN
  supabase/
    schema.sql  policies.sql  functions.sql  seed.sql
  docs/ARCHITECTURE.md
```

## 6. Scanning

- **Barcode:** native `BarcodeDetector` on Android Chrome; vendored **ZXing-wasm** fallback
  for iOS Safari (no support there). One `ui/scanner.js` hides the difference.
- **Unknown barcode:** Open Food Facts lookup (free, no key) → prefill a create sheet →
  save to `products`. Second scan of that code is offline-instant forever.
- **Location QR:** encodes `…/#/l/<qr_slug>`. Scanning from inside the app routes to the
  bin; scanning with the phone camera opens the PWA to it. `features/labels.js` prints
  a sheet of them.
- **Scan modes** — one screen, a mode chip: `Use −1` · `Restock +1` · `Look up` · `Move here`.
  Consuming an item is: open app → scan → done.

## 7. Offline & PWA

- SW precaches the shell; app is fully usable offline against IndexedDB.
- Photos captured offline are stored as blobs in IndexedDB and uploaded to Supabase
  Storage when the outbox drains.
- Versioning, all three moved together on every commit (matching your other apps):
  `VERSION` in `js/core/config.js` (+0.1) · cache string in `sw.js` · `version.txt`.

## 8. Build order

1. **Foundation** — repo, Pages, SW, shell, tokens, router, auth gate, IndexedDB + sync engine, `schema.sql` applied
2. **Locations** — tree CRUD, QR generation, printable labels, scan-to-open
3. **Inventory** — products/items, categories, quick add, stepper, move, photos
4. **Scanning** — barcode modes, Open Food Facts, unknown-item capture
5. **Low stock + shopping** — min quantities, auto list, purchase → restock in one tap
6. **Measurements** — dimension sets, photos, search
7. **Projects** — status board, materials pulled from inventory, cost roll-up
8. **Polish** — history feed, expiry warnings, search across everything

All eight are shipped, and the prediction held: every feature since — maintenance,
quick log, receipts and warranties, insights — landed as a repository plus a screen,
with the sync engine untouched.

## 9. Since the eight phases

**Maintenance** (`maintenance_tasks`, `maintenance_log`) — jobs on a cycle, stored
as a value plus a unit rather than a number of days.

**Receipts and warranties** (`purchases`) — its own table rather than columns on
`items`, for three reasons: you buy the same thing repeatedly and each purchase has
its own price, seller and warranty; a receipt for the water heater should not
require pretending to stock water heaters; and the sync engine already holds writes
gracefully for a table the server does not have yet, whereas an unknown *column*
would 400 and park every item write behind it. A purchase keeps its own `name`, so
deleting the item does not blank the receipt.

**Insights** (`features/analytics.js`) — pure functions over `item_events` and
`purchases`, no new storage. Every one takes an `asOf` date so the answers can be
tested rather than depending on the day the suite runs. Usage counts only `consume`
events: an `adjust` is a recount, and treating a correction as consumption invents
a spike and a false run-out date.

**Photos** (`features/photos.js`, `data/attachments.js`, `ui/photo.js`) — one
`attachments` table for every kind of parent, keyed by `entity_type` + `entity_id`,
so adding photos to a new kind of thing is a string rather than a migration. Three
decisions worth keeping:

- **Shrink before storing, not before sending.** A photo is capped at 1600px the
  moment it is picked, so the phone never holds a 4 MB original either. 1 GB then
  holds a few thousand photos instead of 250.
- **`_blobs` is the queue and the cache at once**, separated by an `uploaded` flag.
  A record stays after it uploads, which is what stops every phone re-downloading
  the same picture on every visit. Egress (5 GB/month) is scarcer than storage.
- **The blob is written before the row.** If the app dies between the two, the
  worst case is an orphan blob wasting space — never a row pointing at a photo
  that does not exist, which is what other phones would see.

**Never repaint under someone's hands.** Three rules, learned from the same bug:

- A re-render is not a navigation. `router.refresh()` keeps the scroll position;
  only a real navigation resets it. A background pull used to throw a reader
  straight back to the top of the inventory every 45 seconds.
- A sync-driven repaint waits while a field has focus or a sheet is open, and is
  paid off on `focusout` or on the next completed sync. Nothing is lost by
  waiting — the data is already in IndexedDB.
- The outlet is never cleared before the next screen is ready. Clearing first and
  then awaiting the module and its data means every tap shows an empty screen for
  as long as that takes. A skeleton appears only after 150ms, so a warm
  navigation never flashes one.

Screens that change their own list in place — shopping is the one so far — own a
root they repaint themselves rather than calling `router.refresh()`, which is what
makes `ui/flip.js` possible: rows are matched across the rebuild by
`data-flip-key` and animated from where they were to where they now are.

The uploader rides on the sync engine's `synced` event rather than keeping a timer:
if the network was good enough to sync, it is good enough to upload. Failures stay
queued rather than being counted out — unlike a bad row, a photo that will not
upload is nearly always transient, and the blob is the household's only copy until
it lands.
