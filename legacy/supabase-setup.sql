-- WorkLog v1.0 — Run this in Supabase SQL Editor
-- Dashboard: supabase.com/dashboard → Your Project → SQL Editor

create table if not exists work_tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  type         text not null default 'meeting'
               check (type in ('pv_lot', 'rd_experiment', 'document', 'meeting', 'production')),
  status       text not null default 'pending'
               check (status in ('pending', 'in_progress', 'done', 'deferred')),
  priority     text not null default 'normal'
               check (priority in ('low', 'normal', 'high', 'critical')),
  start_date   date,
  due_date     date,
  lot_number   text,
  product_code text,
  product_name text,
  section      text,
  assignee     text,
  notes        text,
  source       text not null default 'manual'
               check (source in ('manual', 'sheet')),
  sheet_ref    text unique,   -- unique key for Google Sheet rows (prevents duplicate imports)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Row Level Security (open policy for v1 — tighten with auth later)
alter table work_tasks enable row level security;

create policy "allow_all" on work_tasks
  for all
  using (true)
  with check (true);

-- Index for fast calendar queries
create index if not exists work_tasks_due_date_idx on work_tasks (due_date);
create index if not exists work_tasks_type_idx     on work_tasks (type);
create index if not exists work_tasks_status_idx   on work_tasks (status);

-- Team date notes (Settings → DB Schema also shows this; kept here so a fresh install needs only this file)
create table if not exists work_date_notes (
  id         uuid primary key default gen_random_uuid(),
  note_date  date not null,
  content    text not null,
  category   text not null default 'plan',
  author     text,
  created_at timestamptz default now()
);

alter table work_date_notes enable row level security;

create policy "allow_all" on work_date_notes
  for all
  using (true)
  with check (true);
