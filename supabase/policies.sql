-- Row-level security. Run AFTER schema.sql.
--
-- The anon key is public — it ships in the app bundle, as designed. These policies
-- are what actually protect the data: without signing in to the household account,
-- the anon key can read and write nothing.

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
        using (true)
        with check (true)
    $p$, t, t);
  end loop;
end $$;

-- When a second household is ever added, this becomes:
--   using (household_id = (auth.jwt() -> 'app_metadata' ->> 'household_id')::uuid)
-- and nothing else in the app changes — household_id is already on every row.

-- ------------------------------------------------------------ photo storage

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'photos');

drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos');

drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'photos');
