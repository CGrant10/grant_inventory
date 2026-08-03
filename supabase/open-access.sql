-- OPEN ACCESS — no sign-in.
--
-- Run this to drop the passphrase. Anyone holding the publishable key (which is
-- public: it ships in the app bundle, and the repo is public) can then read and
-- write the household data. That is the deliberate trade for zero-friction use.
--
-- To put the passphrase back, run lock-down.sql.
--
-- One hardening is kept: anon gets select/insert/update but NOT delete. The app
-- only ever soft-deletes (deleted_at is an UPDATE), so nothing is lost, but a
-- passer-by cannot hard-delete rows.

do $$
declare t text;
begin
  foreach t in array array[
    'households','members','categories','locations','products','items',
    'item_events','shopping_items','measurements','measurement_dims',
    'projects','project_lines','attachments'
  ] loop
    -- RLS stays ON. These policies are what open the door, not its absence,
    -- so closing it again is a policy swap rather than a table-by-table toggle.
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);

    execute format($p$
      create policy %I_read on %I
        for select to anon, authenticated using (true)
    $p$, t, t);

    execute format($p$
      create policy %I_insert on %I
        for insert to anon, authenticated with check (true)
    $p$, t, t);

    execute format($p$
      create policy %I_update on %I
        for update to anon, authenticated using (true) with check (true)
    $p$, t, t);

    -- Deliberately no DELETE policy: RLS denies what it does not allow.
  end loop;
end $$;

-- ------------------------------------------------------------ photo storage

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'photos');

drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'photos');

drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'photos');

select 'Open access enabled — no passphrase required.' as status;
