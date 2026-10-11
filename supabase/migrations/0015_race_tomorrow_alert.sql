-- "Race weekend starts tomorrow" push reminder: fires once, ~24h before
-- quali_starts_at, ahead of the existing quali-start-is-now alert.
alter table races add column if not exists race_tomorrow_notified_at timestamptz;
