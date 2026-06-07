create extension if not exists pgcrypto;

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#888',
  is_commissioner boolean not null default false,
  sort_order int not null default 0
);

create table if not exists constructors (
  id text primary key,
  name text not null,
  color text not null default '#888'
);

create table if not exists drivers (
  id text primary key,
  code text,
  number int,
  given_name text, family_name text,
  constructor_id text references constructors(id),
  headshot_url text
);

create table if not exists races (
  id uuid primary key default gen_random_uuid(),
  season int not null, round int not null,
  name text not null, date date,
  status text not null default 'upcoming',
  unique (season, round)
);

create table if not exists qualifying (
  race_id uuid references races(id) on delete cascade,
  driver_id text references drivers(id),
  position int not null,
  primary key (race_id, driver_id)
);

create table if not exists results (
  race_id uuid references races(id) on delete cascade,
  driver_id text references drivers(id),
  finish_position int not null,
  primary key (race_id, driver_id)
);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade unique,
  status text not null default 'open',
  pick_order uuid[] not null,
  rounds int not null default 5
);

create table if not exists picks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade,
  overall int not null,
  round int not null,
  player_id uuid not null references players(id),
  actor_id uuid not null references players(id),
  driver_id text not null references drivers(id),
  created_at timestamptz not null default now(),
  unique (draft_id, overall),
  unique (draft_id, driver_id)
);

-- Realtime: add tables if not already in the publication. Guard with DO block.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'picks'
  ) then
    alter publication supabase_realtime add table public.picks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drafts'
  ) then
    alter publication supabase_realtime add table public.drafts;
  end if;
end$$;
