-- Mark a draft as "historic" = picks backfilled for races that happened before
-- the pool moved into the app (2026 rounds 1-5). These feed the Stats page but
-- are EXCLUDED from championship standings, because those races are already
-- represented by each player's carry_in_points (avoiding a double-count).
alter table drafts add column if not exists historic boolean not null default false;
