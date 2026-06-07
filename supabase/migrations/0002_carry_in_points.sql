-- Carry-in points: each player's cumulative total imported from races that were
-- run before the app existed (the pool started in-app at 2026 round 6, so this
-- carries in their standings after round 5). Added on top of in-app scoring.
alter table players add column if not exists carry_in_points int not null default 0;
