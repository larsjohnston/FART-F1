-- Stand up a SECOND pool inside the EXISTING Supabase project, isolated in its own
-- Postgres schema. This shares one database with the original pool (which lives in
-- `public`) — see docs/SECOND-LEAGUE.md for the full procedure and caveats.
--
-- HOW TO USE: replace every `pool2` below with your chosen schema name (a bare
-- identifier: letters/digits/underscore, no hyphens), then run the whole file
-- against the project's database (Supabase SQL Editor, or the Management API).
-- It is safe to re-run.
--
-- This file does NOT create the tables — it sets up the schema, then you apply the
-- normal migrations (0001..0011) INTO this schema by running each with
-- `set search_path = pool2, extensions;` prepended (the migrations create tables
-- with unqualified names, so the search_path decides where they land). The realtime
-- publication lines inside the migrations are hard-coded to `public`, so this file
-- re-adds the new schema's tables to the publication explicitly at the end.

-- 1. The schema + role access (mirrors how Supabase grants the `public` schema;
--    actual row access is still gated by RLS where a table enables it, e.g.
--    push_subscriptions from migration 0010).
create schema if not exists pool2;
grant usage on schema pool2 to anon, authenticated, service_role;

-- 2. >>> APPLY MIGRATIONS 0001..0011 INTO `pool2` HERE <<<
--    (each prefixed with `set search_path = pool2, extensions;`)
--    Do that step, THEN run the rest of this file.

-- 3. Grant table/sequence privileges on everything the migrations just created,
--    and set defaults so future tables inherit them.
grant all on all tables in schema pool2 to anon, authenticated, service_role;
grant all on all sequences in schema pool2 to anon, authenticated, service_role;
alter default privileges in schema pool2 grant all on tables to anon, authenticated, service_role;
alter default privileges in schema pool2 grant all on sequences to anon, authenticated, service_role;

-- 4. Realtime: add this schema's live tables to the publication (the migrations only
--    added the public ones). A publication can span schemas, so this won't touch the
--    original pool.
alter publication supabase_realtime add table pool2.picks;
alter publication supabase_realtime add table pool2.drafts;
alter publication supabase_realtime add table pool2.results;
alter publication supabase_realtime add table pool2.commentary;

-- 5. Seed the new group's 4 players (swap in real names; exactly one commissioner).
insert into pool2.players (name, color, is_commissioner, sort_order) values
  ('NameA', '#FF4FA3', true,  0),
  ('NameB', '#FF8000', false, 1),
  ('NameC', '#27F4D2', false, 2),
  ('NameD', '#64C4FF', false, 3)
on conflict (name) do nothing;

-- 6. NOT SQL — do this in the dashboard or via the Management API:
--    Settings -> API -> Exposed schemas: add `pool2` (alongside public, graphql_public),
--    so the Data API / PostgREST will serve it. This briefly restarts the API.
