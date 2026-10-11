-- Qualifying-start push alert: the actual session start time (from Jolpica's
-- schedule, once published) and whether we've already notified for it, so the
-- frequent alert cron can fire exactly once per race weekend.
alter table races add column if not exists quali_starts_at timestamptz;
alter table races add column if not exists quali_notified_at timestamptz;
