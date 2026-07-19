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
  (best drafted finisher = 1 pt … worst = N). A drafted driver **with no result ranks LAST**
  (appended after every classified driver), **not 0** — a DNF must never beat a real finisher.
  Only exception: a race with **no results at all** scores everyone 0 (unplayed week stays all-0
  and is skipped downstream).
- A player's weekly total = sum of their 5 drivers. Season = sum across weeks. **Lower is better.**
- A **weekly win** = the lowest weekly total that week (ties share it).
- **Intended rule (confirmed by the user):** every race distributes points **1 through 20**
  across the 20 drafted drivers. Classified finishers rank by finish; **DNFs fill the bottom**
  ordered by the official classification (first to retire = worst = highest points). Once official
  results are in, DNFs carry status `Retired` with real positions, so they sort into the bottom
  naturally; the **rank-last** fallback (above) keeps them at the bottom even *before* that.
- **Provisional-results window (recurs EVERY race — now handled).** The moment a race finishes it may
  hold only **provisional** results (OpenF1), which list **only classified finishers** — DNFs have no
  row yet. Because a no-result drafted driver now **ranks last** (not 0), a provisional week already
  scores a full **1–20 / sum 210** with DNF picks penalised, so the weekly leader is correct
  immediately (verified: the Belgian GP provisional data scores identically to its official data).
  The one caveat: the tail *order* among multiple simultaneous DNFs is stable-but-arbitrary until the
  official classification syncs and resolves who-retired-first. Re-sync a round any time via
  `/api/sync` (below) to pull official data. *(History note: before this fix a missing DNF scored 0 =
  best, so provisional weeks summed < 210 and could crown the wrong leader — e.g. Belgian GP briefly
  showed 171 with Lats "winning" on a phantom 0.)*

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
- `/draft` — the live draft board when a draft is open; otherwise the **F1 Championship** view
  with three tabs: **Drivers**, **Constructors**, **Results**. The **Results** tab (`/api/results`,
  `RaceResultsView` in `draft/page.tsx`) is pure race data — no players/draft: a week selector over
  every race with results (newest first) + the full finishing order (pos, driver, team colour, grid
  or a red **DNF** tag), with a "preliminary" note while a race is still provisional. (Tabs only show
  in the no-draft view, so during a live draft the board replaces them.)
- **Draft picking permission:** only the player **currently on the clock** can pick for themselves;
  the **commissioner** is the sole exception (can pick for an absent player, records as "picked by
  …"). Everyone else sees a disabled board. Gated in the UI only (`pick()` guard + `canPick`), no
  server-side RLS on `picks` — fine for a trusted 4-player pool.
- `/api/results` — **GET** `?season=` → each race's real F1 classification grouped by round
  (newest first), driver/team names + colours resolved, `provisional` flag per race. Powers the
  Results tab. Read-only, publicly readable data.
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
- `/api/sync` — **POST only (manual single-round sync).** Drives the Sync button. Body
  `{season, round}` → `syncRound`, which pulls official Jolpica results server-side and overwrites
  provisional rows. **This is how you fix a "messed-up" provisional week:**
  `curl -X POST https://fart-f1.vercel.app/api/sync -d '{"season":2026,"round":N}'` (runs on Vercel,
  which *can* reach Jolpica). Response `provisional:false` + `drivers:22` confirms official data
  landed. Do it per league (each Vercel deployment writes its own schema).
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
- **⚠️ Installed PWAs snapshot their launch shell — a shell (`<body>`) change won't appear on a plain
  reload.** When debugging a "the layout regressed on my phone but production looks right" report:
  first confirm production actually serves the new shell (`curl -s <domain>/standings | grep '<body'`);
  the SW is network-first for navigations so the *page* is fresh, but iOS re-uses the old
  home-screen-launch `<body>` until the app is **force-quit** (swipe up in the App Switcher, swipe
  the card away) and reopened. Have the user force-quit before concluding a CSS fix didn't work —
  two of this project's "still broken" reports were just a stale launch snapshot of an earlier shell.

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
- **Reaching the DB from this environment (updated — network policy varies!).** In the current
  Claude-Code-on-the-web environment `*.supabase.co` **is reachable** (PostgREST returns 401, not
  000 — test with `curl -o /dev/null -w '%{http_code}' https://oxydbpdbhdfopdafhcxh.supabase.co/rest/v1/`).
  Older sandboxes blocked it; **test reachability before assuming either way.** Two big gotchas:
  - **⚠️ The injected `NEXT_PUBLIC_SUPABASE_URL`/keys point to a DIFFERENT throwaway project**
    (`oxatqehxeogxtsugofxq`, whose `public` schema has a `projects` table), **NOT** the real FART
    project (`oxydbpdbhdfopdafhcxh`). Don't trust the env vars for the real DB — hardcode the real ref.
  - **Get the real read key from the production bundle** (it's the public publishable key, RLS-guarded):
    grep a JS chunk from `https://fart-f1.vercel.app` for `sb_publishable_` — currently
    **`sb_publishable_iXWvflXqVBv41rKv3205KQ_s6qkSuG0`** (new-style key, not a `eyJ…` JWT). Query with
    `-H "apikey: <key>" -H "Authorization: Bearer <key>" -H "Accept-Profile: <schema>"` against
    `/rest/v1/<table>?...` (use `Accept-Profile: fart_a` for the second pool). Read-only tables
    (`picks`, `results`, `drivers`, `races`, `players`, …) are publicly readable.
  - **`SUPABASE_ACCESS_TOKEN` (Management API) is currently Unauthorized**, and the Supabase MCP
    server may be disconnected — so the publishable-key + PostgREST route above is the reliable
    read path. For writes/migrations, prefer the production admin endpoints (`/api/sync`, Re-write
    History, etc.) which run server-side with the service role.
  - `api.jolpi.ca` is still not reachable here — verify sync/standings behaviour by driving the
    **production endpoints** (`fart-f1.vercel.app/api/...`), which run on Vercel.
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
  `origin/main` and reapply changes, then `git push --force-with-lease`. (In practice this session
  used a **fresh branch per change** off `origin/main` — cleaner than reusing a diverged branch.)
- After deploying, confirm the live production deployment is READY and serving the new `main` sha
  (poll `/v13/deployments/<id>` and check `meta.githubCommitSha`).
- **Stop-hook "Unverified commit" after a squash-merge is a false positive — do NOT amend.** Once
  you reset the local branch to `origin/main`, its tip is **GitHub's own squash-merge commit**
  (committer `noreply@github.com`), which the git-check hook flags. That commit is already merged to
  `main` and deployed; amending it would rewrite merged history. Just note it's GitHub's commit and
  take no action. (Only real, locally-authored unpushed commits should get the `--reset-author` fix.)
