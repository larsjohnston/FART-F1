/** The season the pool is currently running. Standings and the draft board are
 *  scoped to this so older test data (e.g. 2024) never bleeds into the live pool. */
export const CURRENT_SEASON = 2026

/** Stable identity for THIS pool/league. Each deployment is a single-tenant copy
 *  of the app (its own Supabase + Vercel project), so the league is configured by
 *  env, not stored per-row. Keeping a stable id/name here means a future
 *  cross-league stats merge can stamp every exported row with where it came from
 *  without guessing. Defaults match the original pool so existing deploys are
 *  unaffected.
 *  - LEAGUE_ID: a short, permanent slug (never reuse across leagues).
 *  - LEAGUE_NAME: human label for branding and AI commentary. */
export const LEAGUE_ID = process.env.NEXT_PUBLIC_LEAGUE_ID ?? 'fart-f1'
export const LEAGUE_NAME = process.env.NEXT_PUBLIC_LEAGUE_NAME ?? 'FART-F1'

/** Postgres schema this pool's tables live in. Defaults to `public` (the original
 *  pool). A second pool can share one Supabase project by living in its own schema
 *  (e.g. `pool2`) — set NEXT_PUBLIC_SUPABASE_SCHEMA on that deployment. Used by both
 *  Supabase clients (`db.schema`) and the realtime subscription filters. Must be a
 *  bare identifier (letters/digits/underscore), and the schema must be added to the
 *  project's exposed Data API schemas. See docs/SECOND-LEAGUE.md. */
export const SUPABASE_SCHEMA = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? 'public'
