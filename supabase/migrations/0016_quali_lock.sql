-- Manual qualifying-grid lock. When set, syncRound leaves this race's
-- `qualifying` rows alone, so a hand-corrected grid (e.g. a grid penalty the
-- data feeds don't reflect) isn't overwritten by the 15-minute autopilot.
-- Set it alongside any manual grid fix; set back to null to resume syncing.
alter table races add column if not exists quali_locked_at timestamptz;
