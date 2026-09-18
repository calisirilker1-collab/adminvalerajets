-- VALERA JETS RFQ AUTOMATION v1
-- Safe to run more than once. Existing CRM and RFQ records are preserved.
-- Supabase > SQL Editor > New query > paste this entire file > Run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Operator directory
-- ---------------------------------------------------------------------------

create table if not exists public.operator_directory (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  aoc_no text,
  email text,
  phone text,
  website text,
  source_url text,
  notes text,
  preferred boolean not null default false,
  email_verified boolean not null default false,
  is_active boolean not null default true,
  last_contacted_at timestamptz
);

alter table public.operator_directory
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists aoc_no text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists source_url text,
  add column if not exists notes text,
  add column if not exists preferred boolean not null default false,
  add column if not exists email_verified boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_contacted_at timestamptz;

create index if not exists operator_directory_active_idx
  on public.operator_directory (is_active, preferred desc, name);

-- ---------------------------------------------------------------------------
-- 2) RFQ send log
-- ---------------------------------------------------------------------------

create table if not exists public.rfq_requests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.flight_requests(id) on delete cascade,
  operator_id uuid references public.operator_directory(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  operator_name text not null,
  operator_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'draft'
    check (status in ('draft','sent','responded','declined','no_availability')),
  sent_at timestamptz,
  responded_at timestamptz,
  batch_id uuid,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending','processing','sent','failed')),
  provider_message_id text,
  error_message text,
  sent_by uuid references auth.users(id) on delete set null
);

alter table public.rfq_requests
  add column if not exists operator_id uuid references public.operator_directory(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists sent_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists batch_id uuid,
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists provider_message_id text,
  add column if not exists error_message text,
  add column if not exists sent_by uuid references auth.users(id) on delete set null;

create index if not exists rfq_requests_request_idx
  on public.rfq_requests (request_id, created_at desc);
create unique index if not exists rfq_requests_batch_operator_uidx
  on public.rfq_requests (batch_id, operator_id);

alter table public.rfq_requests
  drop constraint if exists rfq_requests_delivery_status_check;
alter table public.rfq_requests
  add constraint rfq_requests_delivery_status_check
  check (delivery_status in ('pending','processing','sent','failed'));

-- Reuse the CRM updated_at helper when it exists.
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    drop trigger if exists trg_operator_directory_updated_at on public.operator_directory;
    create trigger trg_operator_directory_updated_at
      before update on public.operator_directory
      for each row execute function public.set_updated_at();

    drop trigger if exists trg_rfq_requests_updated_at on public.rfq_requests;
    create trigger trg_rfq_requests_updated_at
      before update on public.rfq_requests
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Admin-only access from the CRM. The Edge Function uses service_role.
-- ---------------------------------------------------------------------------

alter table public.operator_directory enable row level security;
alter table public.rfq_requests enable row level security;

grant select, insert, update, delete on public.operator_directory to authenticated;
grant select, insert, update, delete on public.rfq_requests to authenticated;
revoke all on public.operator_directory from anon;
revoke all on public.rfq_requests from anon;

drop policy if exists "Valera admins full access operator directory" on public.operator_directory;
create policy "Valera admins full access operator directory"
on public.operator_directory for all to authenticated
using (public.is_valera_admin())
with check (public.is_valera_admin());

drop policy if exists "Valera admins full access RFQ requests" on public.rfq_requests;
create policy "Valera admins full access RFQ requests"
on public.rfq_requests for all to authenticated
using (public.is_valera_admin())
with check (public.is_valera_admin());

-- Expected result: both tables are visible and the new delivery columns exist.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('operator_directory','rfq_requests')
order by table_name;
