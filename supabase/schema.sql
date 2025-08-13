-- Enable required extensions
create extension if not exists pgcrypto;

-- Companies table
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  one_liner text,
  profile_url text not null,
  logo_url text,
  yc_batch text,
  website_url text,
  location text,
  unique(profile_url)
);

-- Row Level Security
alter table public.companies enable row level security;

-- Allow anyone (anon/authenticated) to read companies
drop policy if exists companies_read on public.companies;
create policy companies_read
  on public.companies
  for select
  to public
  using (true);

-- Ensure anon/authenticated have SELECT privileges
grant usage on schema public to anon, authenticated;
grant select on table public.companies to anon, authenticated;

-- No public inserts/updates/deletes by default; service role bypasses RLS


