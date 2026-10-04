-- Valera Jets AI Agent Runtime
-- Run once in Supabase SQL Editor before deploying Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.flight_requests(id) on delete cascade,
  agent_name text not null,
  task_type text not null,
  status text not null default 'pending'
    check (status in ('pending','running','waiting_approval','completed','failed','cancelled')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  requires_approval boolean not null default false,
  approval_id uuid,
  error_message text,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_tasks_request_id_idx on public.agent_tasks(request_id);
create index if not exists agent_tasks_status_available_idx on public.agent_tasks(status, available_at);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.agent_tasks(id) on delete set null,
  request_id uuid not null references public.flight_requests(id) on delete cascade,
  agent_name text not null,
  model text,
  status text not null default 'running'
    check (status in ('running','completed','failed')),
  input_snapshot jsonb,
  output jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists agent_runs_request_id_idx on public.agent_runs(request_id);

create table if not exists public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.flight_requests(id) on delete cascade,
  task_id uuid references public.agent_tasks(id) on delete set null,
  approval_type text not null,
  title text not null,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);

create index if not exists agent_approvals_request_id_idx on public.agent_approvals(request_id);
create index if not exists agent_approvals_status_idx on public.agent_approvals(status);

alter table public.agent_tasks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_approvals enable row level security;

-- Authenticated admin users can read runtime information.
drop policy if exists "admin read agent_tasks" on public.agent_tasks;
create policy "admin read agent_tasks" on public.agent_tasks
for select to authenticated using (true);

drop policy if exists "admin read agent_runs" on public.agent_runs;
create policy "admin read agent_runs" on public.agent_runs
for select to authenticated using (true);

drop policy if exists "admin read agent_approvals" on public.agent_approvals;
create policy "admin read agent_approvals" on public.agent_approvals
for select to authenticated using (true);

-- Agent writes are performed by server-side Edge Functions using the secret/service role.
