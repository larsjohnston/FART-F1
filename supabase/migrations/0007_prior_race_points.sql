-- Per-race points each player scored in races that happened before the pool
-- moved into the app (2026 rounds 1-5). Replaces the single carry_in_points
-- lump with per-race granularity. Entered directly, or computed from backfilled
-- picks. Standings sum these for the prior races, then add in-app scored races.
create table if not exists prior_race_points (
  season int not null,
  round int not null,
  player_id uuid not null references players(id) on delete cascade,
  points int not null default 0,
  primary key (season, round, player_id)
);
