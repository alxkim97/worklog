# WorkLog — Supabase setup

WorkLog uses its own Supabase project (the one v1 used). Run each block once in
**Supabase dashboard → SQL Editor**. Every block is safe to re-run.

Order for the v2 upgrade:
1. `npm run backup` (saves every row to `backups/` while the tables are still open)
2. Block **A** (v1 schema — only needed on a brand-new project)
3. Block **B** (v2 upgrade)
4. Open the app, create your account (Sign up)
5. Block **C** with your email — the app shows this exact SQL on its "not a member yet" screen

## A — base tables (fresh project only)

```sql
create table if not exists work_tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  type         text not null default 'task',
  status       text not null default 'pending',
  priority     text not null default 'normal',
  start_date   date,
  due_date     date,
  lot_number   text,
  product_code text,
  product_name text,
  section      text,
  assignee     text,
  notes        text,
  source       text not null default 'manual',
  sheet_ref    text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists work_date_notes (
  id         uuid primary key default gen_random_uuid(),
  note_date  date not null,
  content    text not null,
  category   text not null default 'plan',
  author     text,
  created_at timestamptz default now()
);
```

## B — v2 upgrade

```sql
-- Who may use WorkLog. Just you for now; teammates later are one insert each.
create table if not exists worklog_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'owner',
  created_at timestamptz not null default now()
);
alter table worklog_members enable row level security;
drop policy if exists "see own membership" on worklog_members;
create policy "see own membership" on worklog_members for select to authenticated
  using (user_id = auth.uid());

create or replace function public.is_worklog_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from worklog_members where user_id = auth.uid())
$$;

-- New task columns. Sheet-owned: step, sheet_path, sheet_seen_at,
-- sheet_removed_at. The sync never writes status/notes/priority/assignee.
alter table work_tasks add column if not exists step             text;
alter table work_tasks add column if not exists sheet_path       text;
alter table work_tasks add column if not exists sheet_seen_at    timestamptz;
alter table work_tasks add column if not exists sheet_removed_at timestamptz;
alter table work_tasks add column if not exists done_at          timestamptz;
alter table work_tasks add column if not exists created_by       uuid default auth.uid();

alter table work_tasks drop constraint if exists work_tasks_type_check;
alter table work_tasks add constraint work_tasks_type_check
  check (type in ('task','rd_experiment','pv_lot','document','meeting','production'));
alter table work_tasks drop constraint if exists work_tasks_status_check;
alter table work_tasks add constraint work_tasks_status_check
  check (status in ('pending','in_progress','done','deferred'));
alter table work_tasks alter column type set default 'task';

-- Section values become dept keys (rd, disp, tablets, cream, liquid, packing, other).
update work_tasks set section = case lower(coalesce(section, ''))
  when 'rd' then 'rd' when 'r&d' then 'rd' when 'disp' then 'disp'
  when 'tablets' then 'tablets' when 'cream' then 'cream'
  when 'liquid' then 'liquid' when 'packing' then 'packing'
  else case when source = 'manual' then 'rd' else 'other' end end
where section is null or section not in ('rd','disp','tablets','cream','liquid','packing','other');

-- v1 sheet rows used an older sheet_ref format and had their notes/status
-- reset on every sync, so there is nothing user-owned in them. Drop them;
-- the first v2 sync re-imports the whole sheet.
delete from work_tasks where source = 'sheet' and sheet_ref not like '%|%|%|%';

create or replace function public.worklog_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists work_tasks_touch on work_tasks;
create trigger work_tasks_touch before insert or update on work_tasks
  for each row execute function worklog_touch();

create index if not exists work_tasks_due_idx   on work_tasks (due_date);
create index if not exists work_tasks_start_idx on work_tasks (start_date);
create index if not exists work_date_notes_date_idx on work_date_notes (note_date);

-- Sync history (written by api/sync-sheet.js with the service key).
create table if not exists worklog_sync_runs (
  id          bigint generated always as identity primary key,
  trigger     text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  found       int,
  added       int,
  removed     int,
  restored    int,
  error       text
);

-- Lock everything down: members only (v1 was open to anyone with the key).
-- Drops every existing policy on these tables, whatever it was named.
alter table work_tasks        enable row level security;
alter table work_date_notes   enable row level security;
alter table worklog_sync_runs enable row level security;
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('work_tasks', 'work_date_notes', 'worklog_sync_runs')
  loop execute format('drop policy %I on %I', p.policyname, p.tablename); end loop;
end $$;
drop policy if exists "members" on work_tasks;
drop policy if exists "members" on work_date_notes;
drop policy if exists "members read" on worklog_sync_runs;
create policy "members" on work_tasks for all to authenticated
  using (is_worklog_member()) with check (is_worklog_member());
create policy "members" on work_date_notes for all to authenticated
  using (is_worklog_member()) with check (is_worklog_member());
create policy "members read" on worklog_sync_runs for select to authenticated
  using (is_worklog_member());
```

## C — make yourself a member (after signing up in the app)

```sql
insert into worklog_members (user_id, role)
select id, 'owner' from auth.users where email = 'YOUR_EMAIL'
on conflict (user_id) do nothing;
```

Then, since it's just you: **Authentication → Sign In / Providers → turn off
"Allow new users to sign up"**. Non-members couldn't see anything anyway, but
there's no reason to let strangers create accounts.

## Vercel environment variables (sheet sync)

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` (secret — Vercel only, never in the app) |
| `GOOGLE_SERVICE_ACCOUNT` | Whole JSON key file of the Google service account |
| `SHEET_ID` | `1GpGLBMrMC3OdVS8alpghKgTn_8PPG7hvT49XQJOrzNc` |
| `CRON_SECRET` | Any long random string |

Share the production sheet with the service account's `client_email` as **Viewer**.
