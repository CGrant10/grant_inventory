-- Row-level security. Run AFTER schema.sql.
--
-- The publishable key is public — it ships in the app bundle, as designed. These
-- policies are what actually protect the data.
--
-- Access is scoped to the ONE household account, not to "any authenticated user".
-- That matters: if email signups are enabled on the project, anyone who reads the
-- key out of the bundle could otherwise register an account and walk straight in.

create or replace function is_household() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'household@grant-inventory.local'
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'households','members','categories','locations','products','items',
    'item_events','shopping_items','measurements','measurement_dims',
    'projects','project_lines','attachments'
  ] loop
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format($p$
      create policy %I_rw on %I
        for all
        to authenticated
        using (is_household())
        with check (is_household())
    $p$, t, t);
  end loop;
end $$;

-- When a second household is ever added, is_household() becomes a household_id
-- comparison and nothing else changes — household_id is already on every row.

-- ------------------------------------------------------------ photo storage

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and is_household());

drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and is_household());

drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and is_household());
