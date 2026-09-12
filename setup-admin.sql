-- VALERA JETS ADMIN PANEL SECURITY SETUP
-- Run this in Supabase > SQL Editor AFTER creating your admin user in Authentication > Users.

-- 1) Keep the request workflow column available.
alter table public.flight_requests
  add column if not exists status text not null default 'new';

-- 2) Admin allow-list. Never expose this table to anonymous visitors.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

-- 3) Security-definer helper. Browser can ask “am I an admin?” without reading admin_users.
create or replace function public.is_valera_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_valera_admin() from public;
grant execute on function public.is_valera_admin() to authenticated;

-- 4) Admins may read/update requests. Anonymous visitors still cannot read them.
alter table public.flight_requests enable row level security;

grant select, update on table public.flight_requests to authenticated;
revoke select, update, delete on table public.flight_requests from anon;

-- Preserve your existing anonymous INSERT policy used by valerajets.com.
-- These policies only add authenticated admin access.
drop policy if exists "Valera admins can read flight requests" on public.flight_requests;
create policy "Valera admins can read flight requests"
on public.flight_requests
for select
to authenticated
using (public.is_valera_admin());

drop policy if exists "Valera admins can update flight requests" on public.flight_requests;
create policy "Valera admins can update flight requests"
on public.flight_requests
for update
to authenticated
using (public.is_valera_admin())
with check (public.is_valera_admin());

-- 5) IMPORTANT: replace YOUR_ADMIN_EMAIL, then run this final statement.
-- First create that email/password user in Supabase > Authentication > Users.
insert into public.admin_users (user_id)
select id
from auth.users
where lower(email) = lower('YOUR_ADMIN_EMAIL')
on conflict (user_id) do nothing;
