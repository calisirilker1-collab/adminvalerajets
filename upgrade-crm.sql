-- VALERA JETS ADMIN CRM UPGRADE v2
-- Supabase > SQL Editor > New query içine TAMAMINI yapıştırıp Run'a basın.
-- Bu migration mevcut flight_requests kayıtlarını silmez.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Existing leads: CRM fields + richer pipeline
-- ---------------------------------------------------------------------------

alter table public.flight_requests
  add column if not exists lead_number bigint,
  add column if not exists preferred_departure_time text,
  add column if not exists lead_source text,
  add column if not exists referral_partner text,
  add column if not exists referral_fee numeric(14,2) not null default 0,
  add column if not exists follow_up_at timestamptz,
  add column if not exists follow_up_note text,
  add column if not exists internal_notes text,
  add column if not exists lost_reason text,
  add column if not exists updated_at timestamptz not null default now();

-- Human friendly lead numbers: VJ-0001, VJ-0002, ...
create sequence if not exists public.valera_lead_number_seq start 1;

-- Ensure the sequence continues after any existing assigned number.
do $$
declare
  max_no bigint;
begin
  select coalesce(max(lead_number), 0) into max_no from public.flight_requests;
  if max_no > 0 then
    perform setval('public.valera_lead_number_seq', max_no, true);
  end if;
end $$;

create or replace function public.assign_valera_lead_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_number is null then
    new.lead_number := nextval('public.valera_lead_number_seq');
  end if;
  return new;
end;
$$;

-- Backfill existing rows in chronological order.
do $$
declare
  r record;
begin
  for r in
    select id from public.flight_requests where lead_number is null order by created_at, id
  loop
    update public.flight_requests
      set lead_number = nextval('public.valera_lead_number_seq')
      where id = r.id;
  end loop;
end $$;

drop trigger if exists trg_assign_valera_lead_number on public.flight_requests;
create trigger trg_assign_valera_lead_number
before insert on public.flight_requests
for each row execute function public.assign_valera_lead_number();

create unique index if not exists flight_requests_lead_number_uidx
  on public.flight_requests (lead_number);
create index if not exists flight_requests_follow_up_idx
  on public.flight_requests (follow_up_at);

-- Expand the original 5-state status constraint.
alter table public.flight_requests
  drop constraint if exists flight_requests_status_check;

alter table public.flight_requests
  add constraint flight_requests_status_check
  check (status in (
    'new',
    'qualified',
    'sourcing',
    'quote_ready',
    'quoted',
    'client_confirmed',
    'payment_pending',
    'booked',
    'flown',
    'won',
    'lost'
  ));

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_flight_requests_updated_at on public.flight_requests;
create trigger trg_flight_requests_updated_at
before update on public.flight_requests
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Operator RFQs / quotes
-- ---------------------------------------------------------------------------

create table if not exists public.operator_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.flight_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  operator_name text not null,
  aircraft_model text not null,
  aircraft_year smallint,
  seats smallint,
  operator_cost numeric(14,2) not null check (operator_cost >= 0),
  currency text not null default 'EUR' check (currency in ('EUR','USD','GBP','TRY')),
  quote_valid_until timestamptz,
  cancellation_terms text,
  reposition_included boolean,
  catering_included boolean,
  notes text
);

create index if not exists operator_quotes_request_idx
  on public.operator_quotes (request_id, created_at desc);

drop trigger if exists trg_operator_quotes_updated_at on public.operator_quotes;
create trigger trg_operator_quotes_updated_at
before update on public.operator_quotes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Client quote versions
-- ---------------------------------------------------------------------------

create table if not exists public.client_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.flight_requests(id) on delete cascade,
  operator_quote_id uuid references public.operator_quotes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  aircraft_model text,
  client_price numeric(14,2) not null check (client_price >= 0),
  currency text not null default 'EUR' check (currency in ('EUR','USD','GBP','TRY')),
  valid_until timestamptz,
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected')),
  sent_at timestamptz,
  notes text
);

create index if not exists client_quotes_request_idx
  on public.client_quotes (request_id, created_at desc);

drop trigger if exists trg_client_quotes_updated_at on public.client_quotes;
create trigger trg_client_quotes_updated_at
before update on public.client_quotes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Deal timeline / activity log
-- ---------------------------------------------------------------------------

create table if not exists public.deal_timeline (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.flight_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null default 'note',
  title text not null,
  detail text
);

create index if not exists deal_timeline_request_idx
  on public.deal_timeline (request_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Admin-only RLS for CRM tables
-- Assumes public.is_valera_admin() already exists from setup-admin.sql.
-- ---------------------------------------------------------------------------

alter table public.operator_quotes enable row level security;
alter table public.client_quotes enable row level security;
alter table public.deal_timeline enable row level security;

grant select, insert, update, delete on public.operator_quotes to authenticated;
grant select, insert, update, delete on public.client_quotes to authenticated;
grant select, insert, update, delete on public.deal_timeline to authenticated;

revoke all on public.operator_quotes from anon;
revoke all on public.client_quotes from anon;
revoke all on public.deal_timeline from anon;

-- Flight requests: admins need to edit CRM fields; anonymous users keep only existing INSERT access.
grant select, update on public.flight_requests to authenticated;
revoke select, update, delete on public.flight_requests from anon;

-- Re-create / ensure admin policies for flight_requests.
drop policy if exists "Valera admins can read flight requests" on public.flight_requests;
create policy "Valera admins can read flight requests"
on public.flight_requests for select to authenticated
using (public.is_valera_admin());

drop policy if exists "Valera admins can update flight requests" on public.flight_requests;
create policy "Valera admins can update flight requests"
on public.flight_requests for update to authenticated
using (public.is_valera_admin())
with check (public.is_valera_admin());

-- Operator quotes policies.
drop policy if exists "Valera admins full access operator quotes" on public.operator_quotes;
create policy "Valera admins full access operator quotes"
on public.operator_quotes for all to authenticated
using (public.is_valera_admin())
with check (public.is_valera_admin());

-- Client quotes policies.
drop policy if exists "Valera admins full access client quotes" on public.client_quotes;
create policy "Valera admins full access client quotes"
on public.client_quotes for all to authenticated
using (public.is_valera_admin())
with check (public.is_valera_admin());

-- Timeline policies.
drop policy if exists "Valera admins full access deal timeline" on public.deal_timeline;
create policy "Valera admins full access deal timeline"
on public.deal_timeline for all to authenticated
using (public.is_valera_admin())
with check (public.is_valera_admin());

-- Optional sanity check. After Run, this should return rows / columns without error.
select id, lead_number, status, follow_up_at, lead_source
from public.flight_requests
order by created_at desc
limit 5;
