# Running a second pool (and linking them later)

The app is **single-tenant**: one deployment = one group of 4. The clean, low-risk
way to onboard a second group of friends is to stand up a **second copy** — its own
Supabase project and its own Vercel project, both deploying this same repo. The two
pools never touch each other's data.

This doc covers (1) standing up the second pool and (2) how the schema is set up so
the two pools can be **merged into one cross-league stats view later** without a
painful migration.

---

## Why a copy, not a multi-tenant refactor

Every table (`players`, `drafts`, `picks`, `prior_race_points`, …) and every query
(`/standings`, `/api/history`, `standings.ts`, the cron autopilot) assumes a single
global pool — there is no `league_id` anywhere. Adding true multi-tenancy means
touching ~10 tables and ~40+ files plus real auth. A second copy gets the new group
playing this weekend with near-zero code risk to the pool that already works.

The only code that ever hard-coded "this group" was the AI commentary prompt; that
now reads the names from the database, and each deployment carries a `LEAGUE_ID` /
`LEAGUE_NAME` (see `src/lib/config.ts`) so it self-identifies.

---

## Part 1 — Stand up the second pool

> **Two ways to host the second pool's data:**
> - **1A. Its own Supabase project** — fully independent infra. Best if you have a
>   project slot free (Supabase free tier caps you at 2 projects).
> - **1B. A second schema in the existing project** — when you're out of free
>   project slots. The two pools share one database (and its connection limits /
>   inactivity-pause fate), but their data stays isolated in separate schemas. This
>   is what `NEXT_PUBLIC_SUPABASE_SCHEMA` + `supabase/second-pool-schema.sql` exist
>   for. Skip to **Part 1B** for this path.

### 1. New Supabase project
- Create a brand-new Supabase project for the new group (free tier is fine).
- Grab its **Project URL**, **anon key**, **service-role key**, and the **direct DB
  connection string** (Project Settings → Database → Connection string / URI).

### 2. Apply the schema + seed the new group
Point `.env.local`'s `SUPABASE_DB_URL` at the **new** project, then apply the full
migration chain in order (each file is idempotent — `create table if not exists`):

```bash
# .env.local: SUPABASE_DB_URL=<new project's connection string>
for f in supabase/migrations/00*.sql; do
  node scripts/apply-migration.mjs "$f"
done
```

> Note: `npm run db:apply` is **not** the right tool here — it only runs `0001_init`
> + `seed.sql` and asserts exactly the *original* 4 players. Use the loop above.

Then seed the new group's players. Copy the template, fill in their display names
(exactly one commissioner), and apply it:

```bash
cp supabase/seed.example.sql /tmp/seed.league2.sql
# edit /tmp/seed.league2.sql — swap Player1..4 for the real names, pick a commissioner
node scripts/apply-migration.mjs /tmp/seed.league2.sql
```

### 3. New Vercel project
- Create a new Vercel project from **this same GitHub repo** (`larsjohnston/FART-F1`),
  production branch `main`. Both pools deploy the same code; they differ only by env.
- Set these env vars on the new project:

  | Variable | Value |
  |---|---|
  | `NEXT_PUBLIC_SUPABASE_URL` | new project URL |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | new anon key |
  | `SUPABASE_SERVICE_ROLE_KEY` | new service-role key |
  | `NEXT_PUBLIC_LEAGUE_ID` | a **new, permanent** slug, e.g. `league-2` (never reuse) |
  | `NEXT_PUBLIC_LEAGUE_NAME` | the new group's display name (branding + AI roasts) |
  | `CRON_SECRET` | a fresh random string (guards the daily autopilot) |
  | `ANTHROPIC_API_KEY` | for "The Booth" commentary (optional) |
  | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | a **fresh** VAPID keypair for push (optional) |
  | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the new public VAPID key |

  Generate a VAPID keypair with `npx web-push generate-vapid-keys` if you want push.

- `vercel.json`'s daily cron ships with the repo, so the new project gets the
  autopilot automatically once `CRON_SECRET` is set.

### 4. First-run setup (as the new commissioner)
- Open the new deployment, pick the commissioner name, go to `/admin`.
- **Load Calendar** to pull the current season's rounds, then **Sync** the current
  race. The autopilot takes over from there.

---

## Part 1B — Second schema in the existing project (out of project slots)

Host the second pool in its own Postgres schema (e.g. `pool2`) inside the current
FART-F1 Supabase project. The code already supports this: set
`NEXT_PUBLIC_SUPABASE_SCHEMA` on the new deployment and every query + realtime
subscription targets that schema (defaults to `public`, so the original pool is
unaffected).

### 1. Create + populate the schema
Edit `supabase/second-pool-schema.sql` — replace `pool2` with your schema name and
fill in the 4 player names — then:
1. Run section 1 (creates the schema + grants usage).
2. Apply migrations `0001`..`0011` **into that schema**: run each file with
   `set search_path = pool2, extensions;` prepended (the migrations use unqualified
   table names, so the search_path decides where they're created).
3. Run sections 3–5 (table grants, realtime publication, seed).

### 2. Expose the schema to the Data API
Supabase dashboard → Settings → API → **Exposed schemas** → add your schema name
(alongside `public`, `graphql_public`). This lets PostgREST serve it. *(Briefly
restarts the API for the whole project — a few seconds' blip for the live pool.)*

### 3. New Vercel project
Same as Part 1, steps 3–4 below, **with two differences**:
- Reuse the **existing** project's `NEXT_PUBLIC_SUPABASE_URL`, anon key, and
  service-role key (it's the same Supabase project).
- Add `NEXT_PUBLIC_SUPABASE_SCHEMA = pool2` (your schema name) to all targets.

Then do the env-var table and first-run setup from Part 1 as normal.

---

## Part 2 — Linking the pools for cross-league stats (later)

Because each pool is a whole database, **its `LEAGUE_ID` is implicit in "which DB the
row came from."** That makes a future merge a pure data operation — no schema
rewrite, no backfill guessing:

1. **Export** the relevant tables from each pool — at minimum `players`,
   `prior_race_points`, `races`, `results`, `drafts`, `picks` (plus `archive_*` for
   deep history).
2. **Stamp** every exported row with a constant `league_id` = that pool's
   `NEXT_PUBLIC_LEAGUE_ID` (`fart-f1`, `league-2`, …). One added column per table.
3. **Union** the stamped exports into a single read-only "stats warehouse" (a third
   Supabase project, or a DuckDB/SQLite file you regenerate on demand).
4. **Compare** by reusing the existing pure scorer (`src/lib/scoring/score.ts`) and
   standings logic over the unioned, league-tagged data — e.g. a "League vs League"
   page, head-to-head best/worst weeks, combined all-time records.

Keep these invariants now so step 2 stays trivial:
- **`LEAGUE_ID` is permanent and unique per pool** — never rename or reuse a slug.
- **Keep the schemas identical** across pools (apply the same migration chain to
  every DB), so a union is a straight `select … ` with the league column added.
- Player names collide across leagues (both could have a "Mike") — when merging, key
  players by `(league_id, player_id)`, never by name.

This is intentionally *not* built yet: it's a separate read-only aggregator, so it
can't affect either live pool. When you want it, this is the spec.
