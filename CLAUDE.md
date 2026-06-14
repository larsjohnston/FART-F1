@AGENTS.md

# FART-F1 — working notes

Mobile-first fantasy F1 draft pool for **4 players** (display names: **Spenny, Shulks, Lats, Horny**).
Each race weekend players draft 5 drivers; **golf scoring** — lowest cumulative finishing
positions wins. `CURRENT_SEASON` lives in `src/lib/config.ts` (currently 2026).

## Scoring rule (`src/lib/scoring/score.ts`)
- Drop the undrafted drivers, then rank the drafted field by finishing position
  (best drafted finisher = 1 pt … worst = N). Drivers with no result score 0.
- A player's weekly total = sum of their 5 drivers. Season = sum across weeks. **Lower is better.**
- A **weekly win** = the lowest weekly total that week (ties share it).

## Data model (Supabase: Postgres + Realtime)
- **Live tables:** `players`, `races` (season, round, name, `date`, status), `drivers`,
  `constructors`, `drafts` (race_id, `historic`), `picks` (player_id, driver_id, draft_id),
  `results` (race_id, driver_id, finish_position, grid, status, `provisional`), `qualifying`,
  `prior_race_points` (per-round points for rounds played before the app, e.g. 2026 R1–5),
  `league_settings`.
- **Archive tables (static spreadsheet import, 2022–2026, read-only history):**
  `archive_race_points` (season, race_no, player_id, points) and
  `archive_picks` (season, player_id, `driver` as TEXT, finish, race_name). There are **no
  committed INSERTs** for these — they were loaded straight into the DB. `archive_picks.driver`
  is a free-text spreadsheet name (not a driver_id).
- **Current season is computed LIVE, not from the archive.** `/api/history` and `/standings`
  build the current season from `prior_race_points` + every race that has results stored
  (provisional *or* official), scored with the pool rule, **skipping `historic` drafts**
  (those rounds are covered by `prior_race_points`). Past seasons come from the archive.
- Data sources: **Jolpica** (Ergast successor) for official results/standings;
  **OpenF1** for provisional results (a session frees ~30 min after it ends). Provisional
  order shows first, official classification (penalties) overwrites it.

## Pages / routes
- `/standings` — **Championship** (season) + **Weekly** views. Championship board shows
  per-player weekly-win trophies (scaled to the leader) and a **Boston Pizza "Beer Tab"**
  badge between the rank and name for **3rd & 4th place** (they cover the tab for 1st & 2nd).
- `/history` — season selector + **All-Time** stats: career totals, season titles,
  most-drafted, **weekly wins**, **records** (best/worst week, longest win streak),
  **Donkey of the year** (wooden spoon = last in a completed season, donkey icon),
  **title margins** (biggest blowout / closest race), **driver awards** (Golden Pick =
  best avg finish; Biggest Letdown = worst avg finish among drivers drafted ≥2×).
- `/admin` — commissioner only. Race selector **defaults to the current race** (most recent
  race with `date` ≤ today, else round 1). Manual **Sync** button → `POST /api/sync`.
- `/api/sync` — **POST only (manual sync).** There is **NO scheduled/automatic sync**: the
  `*/5` cron was removed because the **Vercel Hobby plan only allows once-daily crons**
  (frequent schedules fail the build with `cron_jobs_limits_reached`). `vercel.json` has no
  crons; `CRON_SECRET` and the GET entrypoint are gone. Don't reintroduce crons unless on Pro.

## Assets
- `public/boston-pizza.png` — "Beer Tab" badge logo (provided by the user; don't commit
  trademarked logos yourself). `public/donkey.svg` — original cartoon donkey for the Donkey stat.

## Tech / verifying changes
- Next.js 16 (App Router), TypeScript, Tailwind v4, Vitest, Supabase. (See AGENTS.md: this
  Next.js may differ from training — read `node_modules/next/dist/docs` before writing Next code.)
- **`node_modules` is not installed in a fresh container** — run `npm install` first.
- Check with: `npx tsc --noEmit -p tsconfig.json`, `npx eslint <file>`, `npx vitest run`.
- Pre-existing, non-blocking lint: `/standings` has 2 `setState`-in-effect errors and the
  codebase uses plain `<img>` (`@next/next/no-img-element` warning) per `DriverCard`. These do
  **not** gate `next build` — production deploys succeed with them. Don't churn on them.
- Pure/tested libs: `f1/parse.ts`, `scoring/score.ts`, `draft/engine.ts`. I/O lives in
  `f1/sync.ts` and `draft/service.ts`.

## Deploying (Vercel REST API)
- GitHub: `larsjohnston/FART-F1`, default branch `main`, repoId **1261728598**.
- Vercel (Hobby): project `fart-f1` = `prj_cOADVHaJFnHIRk8zLarHqmdQDO1C`,
  team `team_EVsXBTvNrtKoN6bciUT9LnKA`. Auth via `VERCEL_TOKEN` env var.
- The project's git `link` is empty in the API, so deploy by repoId:
  `POST /v13/deployments?teamId=…&forceNew=1` with
  `{ name:"fart-f1", project:"prj_…", target:"production", gitSource:{ type:"github", repoId:1261728598, ref:"main" } }`,
  then poll `/v13/deployments/<id>` until `readyState` is READY/ERROR/CANCELED.
- Production domains: `fart-f1.vercel.app`, `fart-f1-lars-projects1981.vercel.app`.

## Workflow (user's standing preferences)
- All work on the designated feature branch. For these small changes: open a PR,
  **squash-merge to `main`, then deploy `main` to production — without asking** (confirmed
  preference: "always merge after these small changes, don't need to ask").
- Squash merges leave the feature branch diverged from `main`; reset the branch to
  `origin/main` and reapply changes, then `git push --force-with-lease`.
- After deploying, confirm the live production deployment is READY and serving the new `main` sha.
