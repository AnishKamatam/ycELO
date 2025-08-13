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
  status text not null default 'Active',
  elo_rating numeric not null default 1500,
  elo_games_count integer not null default 0,
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

-- Votes table (records decisions between two companies)
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  left_company uuid not null references public.companies(id) on delete cascade,
  right_company uuid not null references public.companies(id) on delete cascade,
  winner_company uuid not null references public.companies(id) on delete cascade,
  voter_session text
);

alter table public.votes enable row level security;

-- Allow public read of votes (optional)
drop policy if exists votes_read on public.votes;
create policy votes_read
  on public.votes
  for select
  to public
  using (true);

-- Do not allow direct inserts/updates/deletes to votes by public; inserts happen via RPC function under SECURITY DEFINER

-- Prevent duplicate voting on the same pair per session (order-insensitive)
create unique index if not exists votes_unique_per_session_pair
on public.votes (
  voter_session,
  LEAST(left_company, right_company),
  GREATEST(left_company, right_company)
);

-- Function: get two random companies
drop function if exists public.get_two_random_companies cascade;
create function public.get_two_random_companies()
returns setof public.companies
language sql
stable
as $$
  select *
  from public.companies
  where coalesce(status, 'Active') ilike 'Active'
  order by random()
  limit 2;
$$;
grant execute on function public.get_two_random_companies() to anon, authenticated;

-- Function: record vote and update Elo in a single transaction
drop function if exists public.record_vote_and_update_elo(uuid, uuid, uuid, integer, text) cascade;
create function public.record_vote_and_update_elo(
  left_id uuid,
  right_id uuid,
  winner_id uuid,
  k integer default 32,
  voter_session text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  left_rating numeric;
  right_rating numeric;
  s_left numeric;
  s_right numeric;
  e_left numeric;
  e_right numeric;
  recent_count integer := 0;
begin
  if left_id = right_id then
    raise exception 'Left and right company must be different';
  end if;
  if winner_id <> left_id and winner_id <> right_id then
    raise exception 'Winner must be either left or right company';
  end if;

  -- Optional basic rate limit: max 10 votes per minute per session
  if voter_session is not null then
    select count(*) into recent_count
    from public.votes v
    where v.voter_session = record_vote_and_update_elo.voter_session
      and v.created_at > now() - interval '1 minute';
    if recent_count >= 10 then
      raise exception 'Rate limited';
    end if;
  end if;

  -- Lock rows for update ensuring both companies are Active
  select elo_rating into left_rating from public.companies where id = left_id and status ilike 'Active' for update;
  select elo_rating into right_rating from public.companies where id = right_id and status ilike 'Active' for update;
  if left_rating is null or right_rating is null then
    raise exception 'Company not active or not found';
  end if;

  e_left := 1.0 / (1.0 + power(10, (right_rating - left_rating)/400.0));
  e_right := 1.0 / (1.0 + power(10, (left_rating - right_rating)/400.0));
  s_left := case when winner_id = left_id then 1 else 0 end;
  s_right := case when winner_id = right_id then 1 else 0 end;

  update public.companies
    set elo_rating = elo_rating + k * (s_left - e_left),
        elo_games_count = elo_games_count + 1
    where id = left_id;

  update public.companies
    set elo_rating = elo_rating + k * (s_right - e_right),
        elo_games_count = elo_games_count + 1
    where id = right_id;

  insert into public.votes (left_company, right_company, winner_company, voter_session)
  values (left_id, right_id, winner_id, voter_session);
end;
$$;
grant execute on function public.record_vote_and_update_elo(uuid, uuid, uuid, integer, text) to anon, authenticated;

-- Optimize leaderboard queries
create index if not exists companies_elo_desc_idx on public.companies (elo_rating desc);
create index if not exists companies_elo_composite_idx on public.companies (elo_rating desc, elo_games_count desc, name asc);
create index if not exists companies_status_idx on public.companies (status);

-- Backfill and enforce default for status if table already existed
alter table if exists public.companies alter column status set default 'Active';
update public.companies set status = 'Active' where status is null;

-- No public inserts/updates/deletes by default; service role bypasses RLS


