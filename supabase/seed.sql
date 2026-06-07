insert into players (name, color, is_commissioner, sort_order) values
  ('Lats',   '#FF4FA3', true,  0),
  ('Horny',  '#FF8000', false, 1),
  ('Shulks', '#27F4D2', false, 2),
  ('Spenny', '#64C4FF', false, 3)
on conflict (name) do nothing;
