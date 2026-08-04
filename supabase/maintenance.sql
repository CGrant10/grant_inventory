-- Household maintenance — recurring jobs and when they are next due.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- The interval is stored as a value plus a unit rather than a number of days.
-- "Every 6 months" landing on the same day of the month is what people mean;
-- 182 days drifts, and by the third change it is in the wrong week.

create table if not exists maintenance_tasks (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null default default_household() references households(id),
  name            text not null,
  notes           text,
  location_id     uuid references locations(id) on delete set null,

  -- Optional link to stock: changing a filter should also use one up.
  item_id         uuid references items(id) on delete set null,
  consume_quantity numeric not null default 1,

  interval_value  int not null default 6,
  interval_unit   text not null default 'month',   -- day|week|month|year
  last_done_on    date,
  next_due_on     date,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists maintenance_due_idx on maintenance_tasks(next_due_on)
  where deleted_at is null;

-- Append-only history: what was done and when, so "when did we last do this"
-- survives someone editing the schedule.
create table if not exists maintenance_log (
  id            uuid primary key,
  household_id  uuid not null default default_household() references households(id),
  task_id       uuid not null references maintenance_tasks(id) on delete cascade,
  done_on       date not null,
  member_id     uuid,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists maintenance_log_task_idx on maintenance_log(task_id);

-- updated_at trigger, matching every other table.
drop trigger if exists maintenance_tasks_touch on maintenance_tasks;
create trigger maintenance_tasks_touch before update on maintenance_tasks
  for each row execute function touch_updated_at();

-- Row-level security, matching whichever mode the project is in. These grants
-- mirror open-access.sql: select/insert/update for anon, no delete.
alter table maintenance_tasks enable row level security;
alter table maintenance_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['maintenance_tasks', 'maintenance_log'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);

    execute format('create policy %I_read on %I for select to anon, authenticated using (true)', t, t);
    execute format('create policy %I_insert on %I for insert to anon, authenticated with check (true)', t, t);
    execute format('create policy %I_update on %I for update to anon, authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

select 'Maintenance tables installed.' as status;
