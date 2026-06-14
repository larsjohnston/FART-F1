# FART-F1

Mobile-first fantasy F1 draft pool for 4 players. Each race weekend you draft 5 drivers; lowest cumulative finishing positions wins the season (golf-style scoring).

- Spec: [`docs/superpowers/specs/2026-06-06-f1-fantasy-draft-pool-design.md`](docs/superpowers/specs/2026-06-06-f1-fantasy-draft-pool-design.md)
- Milestone 1 plan: [`docs/superpowers/plans/2026-06-06-m1-draft-core.md`](docs/superpowers/plans/2026-06-06-m1-draft-core.md)

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Vitest · Supabase (Postgres + Realtime) · Vercel.

## Local dev

```bash
npm install
cp .env.local.example .env.local   # then paste your Supabase values
npm run dev
```

`.env.local` needs:

```
NEXT_PUBLIC_SUPABASE_URL=         # Project URL from Supabase → Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # anon public key (JWT, ~200+ chars)
SUPABASE_SERVICE_ROLE_KEY=        # service_role key (JWT, ~200+ chars) — server only
SUPABASE_DB_URL=                  # Postgres connection string for migrations + sync script
F1_SEASON=2024
CRON_SECRET=                      # random token guarding the GET /api/sync cron (see Scheduled sync)
```

## One-time setup

```bash
npm run db:apply       # creates tables + seeds the 4 players via SUPABASE_DB_URL
npm run sync:season    # fetches Jolpica + OpenF1 for every round of F1_SEASON, upserts to DB
```

`db:apply` is idempotent (CREATE IF NOT EXISTS, ON CONFLICT DO NOTHING). `sync:season` runs through round 24, breaking on the first empty round.

## Scheduled sync

`vercel.json` registers a cron that hits `GET /api/sync` every 5 minutes. It re-syncs the most recent race that has already happened, so results appear hands-free. Note OpenF1 keeps a session on its **paid real-time tier until ~30 min after it ends**, so the **provisional** finishing order shows up roughly half an hour after the flag (not immediately); Jolpica's **official** classification (penalties applied) then overwrites it the moment it posts.

Set `CRON_SECRET` in the hosting env (Vercel → Project → Settings → Environment Variables). Vercel sends it automatically as `Authorization: Bearer <CRON_SECRET>`, and the route rejects any GET without it. Generate one with:

```bash
openssl rand -hex 32
```

If `CRON_SECRET` is unset the route stays open (fine for local dev). The commissioner's manual **Sync** button on `/admin` still works regardless.

## How it works

1. **Pick your name** (`/`) — tap a player; the choice persists in localStorage.
2. **Admin** (`/admin`, commissioner only) — Sync a round, set draft order, open the draft, undo, close & score.
3. **Draft** (`/draft`) — straight 1-2-3-4 order for 5 rounds. Picks broadcast live to all devices via Supabase Realtime. Anyone can pick on behalf of an absent player; the actor is stamped separately.
4. **Standings** (`/standings`) — cumulative golf scoring across every race marked `complete`.

## Scoring

A driver scores their finishing position (winner = 1, 20th = 20). A player's weekly total is the sum of their 5 drivers. Season total adds across weeks. Lower is better.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next dev server on http://localhost:3000 |
| `npm run build` | Production build + typecheck |
| `npm test` | Vitest run (pure parser / scoring / draft engine tests) |
| `npm run db:apply` | Apply migration + seed via direct Postgres |
| `npm run sync:season` | Backfill a full F1 season via Jolpica + OpenF1 |

## Deploying

See Vercel + env-var steps in [`MORNING.md`](MORNING.md) for the current bootstrap state.

## Architecture boundaries

- `src/lib/f1/parse.ts`, `src/lib/scoring/score.ts`, `src/lib/draft/engine.ts` are **pure** (no I/O) and carry the unit tests.
- `src/lib/f1/sync.ts` and `src/lib/draft/service.ts` own all DB / realtime I/O.
- `src/components/*` are presentational; `src/app/**/page.tsx` wires data + context.
