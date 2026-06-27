-- Pre-qualifying drafts open on a chosen weekday ("Draft Floor" day).
-- 1 = Monday … 6 = Saturday (ISO-ish; matches the UI selector). Only consulted
-- when draft_timing = 'before'. Default Monday keeps the prior "day after the
-- previous race" behaviour for weekly calendars.
alter table league_settings add column if not exists draft_open_day int not null default 1;
