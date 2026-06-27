-- Web Push subscriptions: one row per installed device per player.
-- All access is server-side (service role), so RLS is enabled with no policies
-- to keep endpoints/keys private from the anon client.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_player_idx on push_subscriptions (player_id);

alter table push_subscriptions enable row level security;
