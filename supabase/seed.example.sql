-- Seed for a NEW pool (a second group of 4 friends running their own draft).
--
-- This is a TEMPLATE — copy it, swap in the new group's display names, and run it
-- once against THAT group's own Supabase project (not the original FART-F1 DB).
-- Each pool lives in its own database; see docs/SECOND-LEAGUE.md.
--
-- Exactly one player should be the commissioner (is_commissioner = true) — they
-- get the /admin controls. `color` is the player's accent colour in the UI;
-- `sort_order` is the default board order (0-based).

insert into players (name, color, is_commissioner, sort_order) values
  ('Player1', '#FF4FA3', true,  0),
  ('Player2', '#FF8000', false, 1),
  ('Player3', '#27F4D2', false, 2),
  ('Player4', '#64C4FF', false, 3)
on conflict (name) do nothing;
