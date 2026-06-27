-- Commissioner-configurable league settings + player photos.
--
-- league_settings gains:
--   league_name        — human label (branding + AI commentary).
--   drivers_per_week    — how many drivers each player drafts per race (draft `rounds`).
--   draft_order_type    — 'sequential' (same order every round) | 'snake' (reverse each round).
--   draft_order_basis   — 'overall' (cumulative season standings, worst-first) |
--                         'weekly'  (last completed race's weekly total, worst-first).
alter table league_settings add column if not exists league_name text not null default 'FART-F1';
alter table league_settings add column if not exists drivers_per_week int not null default 5;
alter table league_settings add column if not exists draft_order_type text not null default 'sequential';
alter table league_settings add column if not exists draft_order_basis text not null default 'overall';

-- Per-draft snapshot of the snake setting so an in-progress draft keeps its rule
-- even if the league setting changes mid-season.
alter table drafts add column if not exists snake boolean not null default false;

-- Optional player photo, stored inline as a small client-resized data URL.
alter table players add column if not exists photo_url text;
