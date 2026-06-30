-- Enable Row-Level Security on every data table so the Supabase advisor stops
-- flagging "RLS Disabled in Public" (a table with RLS off is reachable by anyone
-- holding the public anon key — which ships in the browser bundle).
--
-- ⚠️ HONEST SCOPE: this is the "silence the advisor" fix, NOT real protection.
-- The app has no authentication and the browser (anon key) both READS and WRITES
-- these tables directly (draft picks, results entry, admin edits — see
-- src/lib/draft/service.ts and src/app/admin/*). So the policy below is fully
-- permissive: anon + authenticated may still do everything. The advisor goes
-- green and app behaviour is unchanged, but a stranger with the URL can still
-- read/edit/delete this pool's data. To actually lock it down you'd move all
-- writes to server-side API routes (service role bypasses RLS) and serve only
-- SELECT to anon — left as a follow-up.
--
-- push_subscriptions is deliberately NOT in this list: migration 0010 already
-- enabled RLS on it with NO policies (server-only via service role), keeping
-- device endpoints/keys private. Don't loosen it.
--
-- service_role bypasses RLS entirely, so server-side code (sync, push, cron,
-- API routes) is unaffected and needs no policy.
--
-- Idempotent and schema-agnostic: it operates on whatever is in search_path, so
-- the SECOND pool gets it by running this file with
-- `set search_path = fart_a, extensions;` prepended (see CLAUDE.md / docs).

do $$
declare
  t text;
begin
  foreach t in array array[
    'players', 'constructors', 'drivers', 'races', 'qualifying', 'results',
    'drafts', 'picks', 'league_settings', 'prior_race_points',
    'archive_race_points', 'archive_picks', 'commentary'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Public full access" on %I', t);
    execute format(
      'create policy "Public full access" on %I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end$$;
