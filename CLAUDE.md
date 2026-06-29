@AGENTS.md

# FART-F1 — working notes

Mobile-first fantasy F1 draft pool for **4 players** (display names: **Spenny, Shulks, Lats, Horny**).
Each race weekend players draft 5 drivers; **golf scoring** — lowest cumulative finishing
positions wins. `CURRENT_SEASON` lives in `src/lib/config.ts` (currently 2026).

## Multiple pools (single-tenant by copy) — ⚠️ THERE ARE TWO LIVE POOLS
The app is single-tenant; a second group runs as a **separate deployment of the same repo**
pointed at its own data. Pools are distinguished by env (`src/lib/config.ts`):
`LEAGUE_ID` / `LEAGUE_NAME` (identity + branding + AI-commentary roster) and
`SUPABASE_SCHEMA` (which Postgres schema the tables live in; both Supabase clients +
realtime filters honour it). Defaults: `fart-f1` / `FART-F1` / `public`.
- **FART E** — the original pool. Vercel project `fart-f1`, schema `public`,
  domain `fart-f1.vercel.app`.
- **FART A** — second pool. Vercel project `fart-a` (`prj_nh4c2HJ2NtMhiQJagER1QW6jTEhL`),
  schema `fart_a`, domain **`fart-a.vercel.app`**, players Tamags (commissioner)/Ned/Tup/Mendo.
  Both pools share the **same Supabase project** (`oxydbpdbhdfopdafhcxh`) — separate schemas,
  isolated data, but shared DB instance / connection limits / inactivity-pause fate.
- **⚠️ Consequences for any future change:**
  - **Code/deploys:** production for each pool is deployed by repoId to its own Vercel
    project — a code change must be deployed to **both** `fart-f1` and `fart-a`.
  - **DB migrations:** a new migration must be applied to **both** `public` and `fart_a`
    (run it with `set search_path = fart_a, extensions;` for the second schema; the realtime
    `alter publication` lines are hard-coded to `public`, so add `fart_a.<table>` explicitly —
    see `supabase/second-pool-schema.sql`). New realtime schemas must also be in the project's
    exposed Data API schemas (`db_schema` via the Management API `/postgrest` config).
  - See `docs/SECOND-LEAGUE.md` (standup runbook + cross-league stats merge spec) and
    `supabase/second-pool-schema.sql` (the schema setup that was run for FART A).

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
  `league_settings`,
  `push_subscriptions` (player_id, endpoint, p256dh, auth — one row per installed device;
  RLS **on** with no policies, so server-only via service role) and
  `commentary` (draft_id, overall, text — one AI trash-talk quip per pick, in the realtime
  publication, publicly readable like picks/results).
- **Realtime publication** includes `picks`, `drafts`, `results`, `commentary` (add new tables
  with `alter publication supabase_realtime add table <t>` — see migrations 0003 / 0011).
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
  Also **Load Calendar** (`POST /api/calendar` → `syncCalendar`, upserts the whole season's
  rounds, name+date only so statuses survive) and **Advance now** (`POST /api/cron`).
- `/stats` (`/api/stats`) — Drivers + Players tables. **FART Pts** = a season-long
  finishing-rank tally for **every driver, drafted or not**: each race, rank the full
  classified field by finish (winner = 1 … backmarker = N) and sum across the season (lower =
  better). It is *not* drafted-only — an earlier version summed only drafted races, which let a
  rarely-picked driver (e.g. Stroll, drafted once) float to the top; fixed in `/api/stats`
  (`rankDraftedPoints` is reused over the **whole grid**). Weekly wins still use the drafted-only
  pool rule. Track-history (Jolpica) is best-effort and never fatal.
- `/api/sync` — **POST only (manual single-round sync).** Drives the Sync button.
- **Season autopilot — `/api/cron` (`syncCalendar` + `advanceSeason`).** A **once-daily**
  Vercel cron (`vercel.json`: `0 6 * * *`) — Hobby allows daily crons; only the old `*/5`
  schedule failed (`cron_jobs_limits_reached`). **GET** is the cron entry, guarded by
  `CRON_SECRET` (Vercel auto-sends `Authorization: Bearer <CRON_SECRET>`); **POST** is the
  unguarded "Advance now" manual trigger. Each run is **idempotent**: loads the full calendar,
  syncs the current + next race, auto-completes finished races (results present + `date` ≤ today),
  and opens the next race's draft with the pick order auto-set from standings — gated by
  `league_settings.draft_timing` (**before** = open day after the previous race; **after** =
  open once that race's qualifying is synced). Only one draft open at a time; never reopens a
  `drafting`/`complete` race. **Requires `CRON_SECRET` set in Vercel project env.**

## PWA (installable app)
- Installable to the home screen on iOS + Android (Add to Home Screen / Install app), launches
  fullscreen. `app/manifest.ts` (standalone, portrait, theme `#0d1117`), branded icons generated
  with `sharp` (`public/icon-192/512/-maskable.png`, `app/icon.png`, `app/apple-icon.png`),
  Apple/viewport meta in `app/layout.tsx` (incl. legacy `apple-mobile-web-app-capable`),
  `public/sw.js` (service worker — installability + offline page; **never caches `/api` or
  Supabase**, so live data stays fresh), `public/offline.html`, `components/ServiceWorker.tsx`.
- **BottomNav pinning (iOS) — app-shell layout, NOT `position: fixed`.** A fixed bottom bar gets
  stranded mid-page during iOS Safari momentum scroll, and the `transform: translateZ(0)` /
  `will-change` compositor-layer hack only *partly* mitigated it (still detached on fast flicks).
  **The real fix:** the whole app is a flex column pinned to the visual viewport and only an inner
  container scrolls, so the nav is a static footer that physically cannot move. In `app/layout.tsx`
  the `<body>` is `position: fixed; inset: 0; display: flex; flex-direction: column; overflow: hidden;
  padding-top: env(safe-area-inset-top)`; `{children}` live in a single `flex: 1; min-height: 0;
  overflow-y: auto` scroll container; `BottomNav` is the last flex child (`flex-shrink: 0`,
  `env(safe-area-inset-bottom)` padding). **Do NOT use `height: 100dvh` for the shell** — `dvh`
  renders short of the physical screen in iOS standalone (PWA), leaving the column floating with a
  dead strip below the nav and content tucked under the status bar; `100vh` over-fills regular
  Safari. `position: fixed; inset: 0` anchors to the visual viewport in both. **Rules so this never regresses:**
  (1) never give `BottomNav` `position: fixed`/`sticky` again — keep it a static flex child;
  (2) the document body must not scroll — put any new full-page scrolling inside that one container;
  (3) don't put `transform`/`filter`/`will-change` on `body` or the scroll container (it would make
  any descendant `position: fixed` scroll with content — the same stranding bug);
  (4) pages no longer need bottom padding to clear the nav (the nav takes real layout space).
  Trade-off: the Safari URL bar stays put (the body doesn't scroll) — fine for this PWA-first app.
  Desktop/headless can't reproduce iOS compositing — verify nav-pinning changes on a real iPhone.

## Push notifications (Web Push)
- During a draft: **"🏁 You're on the clock"** to the next player + **"a pick was made"** to
  every other player. Works only on **installed PWAs** (iOS 16.4+ requires Add-to-Home-Screen),
  after the player taps **🔔 Notify me on my turn** on `/draft` (`components/EnableNotifications.tsx`).
- `lib/push/server.ts` (`sendToPlayers`, `web-push`, prunes dead 404/410 subs);
  `POST /api/push/subscribe` (stores a device sub); `POST /api/push/notify-pick` (fired
  fire-and-forget by the picking client — recomputes draft state, generates commentary, sends
  the two pushes). **VAPID keys set in Vercel** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`).

## AI commentary — "The Booth" (`lib/commentary/generate.ts`)
- Sarcastic one-line trash-talk per pick via the **Claude API** (`@anthropic-ai/sdk`,
  model `claude-opus-4-8`, `effort: low`, ~200 max tokens, final-answer-only system prompt).
  Material = player, driver, team, that race's qualifying spot. Stored in `commentary` (shown
  live in the **📣 The Booth** feed on `/draft` via realtime) and used as the "pick made" push body.
- **Best-effort:** returns `null` if `ANTHROPIC_API_KEY` is unset or the call fails — picks and
  push still work with a plain fallback body. **⚠️ `ANTHROPIC_API_KEY` is NOT yet set in Vercel**
  (parked) — until added, The Booth is dormant. Add via console.anthropic.com → set in Vercel env
  (all targets) → redeploy.

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
  `f1/sync.ts`, `draft/service.ts`, `season/advance.ts`, `push/server.ts`, `commentary/generate.ts`.
- Runtime deps added this era: `web-push` (+ `@types/web-push`) for Web Push, `@anthropic-ai/sdk`
  for commentary. New `set-state-in-effect` lint on browser-capability effects is suppressed inline
  on the exact `setState` line (same accepted pattern as the pre-existing `/standings`, `/draft` ones).

## Deploying (Vercel REST API)
- GitHub: `larsjohnston/FART-F1`, default branch `main`, repoId **1261728598**.
- Vercel (Hobby): project `fart-f1` = `prj_cOADVHaJFnHIRk8zLarHqmdQDO1C`,
  team `team_EVsXBTvNrtKoN6bciUT9LnKA`. Auth via `VERCEL_TOKEN` env var.
- The project's git `link` is empty in the API, so deploy by repoId:
  `POST /v13/deployments?teamId=…&forceNew=1` with
  `{ name:"fart-f1", project:"prj_…", target:"production", gitSource:{ type:"github", repoId:1261728598, ref:"main" } }`,
  then poll `/v13/deployments/<id>` until `readyState` is READY/ERROR/CANCELED.
- Production domains: `fart-f1.vercel.app`, `fart-f1-lars-projects1981.vercel.app`.

## Supabase + env (infra learnings)
- Supabase project **ref `oxydbpdbhdfopdafhcxh`** (URL `https://oxydbpdbhdfopdafhcxh.supabase.co`),
  name "larsjohnston's Project". The other project (`Spec-Writer`) is **not** this app.
- **The sandbox can't reach Supabase or Jolpica directly** (the agent proxy blocks `*.supabase.co`
  and `api.jolpi.ca` — curl returns 000). So: run migrations / inspect data via the **Supabase
  Management API** (`https://api.supabase.com`, reachable) with `SUPABASE_ACCESS_TOKEN`:
  `POST /v1/projects/<ref>/database/query {"query": "..."}`. To verify app behaviour, drive the
  **production endpoints** (`fart-f1.vercel.app/api/...`) instead of localhost.
- **Vercel env vars are per-target.** Supabase vars were set for **production only**, which broke
  every **Preview** build with `supabaseUrl is required` (several routes transitively import the
  browser supabase client `lib/supabase/client.ts`, which calls `createClient(url, …)` at *module
  load*, so build-time page-data collection needs the URL). Fixed by also setting
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` for
  **preview + development**. Production deploys (by repoId) always worked because they use the
  Production env. Set env via `POST /v10/projects/<id>/env?upsert=true` (target array per request).
- **Currently set in Vercel:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (all targets), `CRON_SECRET`, the four `VAPID*` keys, `F1_SEASON`.
  **Missing/parked:** `ANTHROPIC_API_KEY` (needed for The Booth).
- The Vercel GitHub integration posts preview deploys + status on PRs; production is still deployed
  by repoId (above), independent of those preview builds.

## Workflow (user's standing preferences)
- All work on the designated feature branch. For these small changes: open a PR,
  **squash-merge to `main`, then deploy `main` to production — without asking** (confirmed
  preference: "always merge after these small changes, don't need to ask").
- Squash merges leave the feature branch diverged from `main`; reset the branch to
  `origin/main` and reapply changes, then `git push --force-with-lease`.
- After deploying, confirm the live production deployment is READY and serving the new `main` sha.
