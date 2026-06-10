-- Historical archive imported from the league's multi-season spreadsheet
-- (F.A.R.T. 2022-2026). Read-only history powering the History/Records page.
-- Kept separate from the live Jolpica-based tables because the pool's own race
-- numbering/calendar diverges from the official one.

-- Per-race points per player (from the spreadsheet's authoritative totals table).
create table if not exists archive_race_points (
  season int not null,
  race_no int not null,
  player_id uuid not null references players(id) on delete cascade,
  points int not null,
  primary key (season, race_no, player_id)
);

-- Each drafted driver + finishing position (from the per-race detail blocks),
-- for career pick stats. driver is stored as text (covers retired drivers).
create table if not exists archive_picks (
  id bigserial primary key,
  season int not null,
  player_id uuid not null references players(id) on delete cascade,
  driver text not null,
  finish int not null,
  race_name text
);
create index if not exists archive_picks_season_idx on archive_picks (season);
