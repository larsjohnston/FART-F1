-- Single-row league settings. draft_timing controls how the draft board is
-- populated: 'after' = the qualifying grid (filtered to that race's qualifiers);
-- 'before' = all current drivers ranked by the F1 drivers' championship, usable
-- as soon as the prior race is closed (no qualifying needed).
create table if not exists league_settings (
  id int primary key default 1,
  draft_timing text not null default 'after',
  constraint league_settings_single_row check (id = 1)
);
insert into league_settings (id, draft_timing) values (1, 'after') on conflict (id) do nothing;
