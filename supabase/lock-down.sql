-- LOCK DOWN — put the passphrase back.
--
-- Reverses open-access.sql: anonymous access is removed and every table is
-- scoped again to the one household account.
--
-- Also set REQUIRE_PASSPHRASE = true in js/core/config.js, or the app will keep
-- skipping the gate and then fail every request.

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

    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('drop policy if exists %I_rw on %I', t, t);

    execute format($p$
      create policy %I_rw on %I
        for all to authenticated
        using (is_household()) with check (is_household())
    $p$, t, t);
  end loop;
end $$;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select to authenticated using (bucket_id = 'photos' and is_household());

drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and is_household());

drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects
  for update to authenticated using (bucket_id = 'photos' and is_household());

select 'Locked down — household passphrase required again.' as status;
