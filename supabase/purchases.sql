-- Receipts and warranties — what was bought, for how much, and what is still covered.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- A purchase is deliberately its own row rather than columns on `items`, because
-- you buy the same thing many times and each purchase has its own price, seller
-- and warranty. It also keeps `name` of its own: delete the item and the receipt
-- still says what you paid for.
--
-- The link to an item is optional. A refrigerator you never counted as stock is
-- still worth recording a warranty for.

create table if not exists purchases (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default default_household() references households(id),

  item_id       uuid references items(id) on delete set null,
  name          text not null,
  vendor        text,

  purchased_on  date,
  price         numeric,
  quantity      numeric not null default 1,

  warranty_until date,
  serial_number  text,
  model_number   text,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists purchases_item_idx on purchases(item_id);
create index if not exists purchases_date_idx on purchases(purchased_on desc)
  where deleted_at is null;
create index if not exists purchases_warranty_idx on purchases(warranty_until)
  where deleted_at is null and warranty_until is not null;

-- updated_at trigger, matching every other table.
drop trigger if exists purchases_touch on purchases;
create trigger purchases_touch before update on purchases
  for each row execute function touch_updated_at();

-- Row-level security, mirroring open-access.sql: select/insert/update for anon,
-- no delete — the app only ever soft-deletes.
alter table purchases enable row level security;

drop policy if exists purchases_read on purchases;
drop policy if exists purchases_insert on purchases;
drop policy if exists purchases_update on purchases;

create policy purchases_read   on purchases for select to anon, authenticated using (true);
create policy purchases_insert on purchases for insert to anon, authenticated with check (true);
create policy purchases_update on purchases for update to anon, authenticated using (true) with check (true);

select 'Purchases table installed.' as status;
