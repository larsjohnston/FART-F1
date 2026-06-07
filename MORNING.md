# Good morning ☕ — here's the state of FART-F1

Worked through Milestone 1 last night while you slept. The whole draft loop is built, tested, and committed on `main`. The 2024 F1 season is synced to your Supabase project. There's one thing **you have to fix yourself** before any of it works end-to-end in the browser, and one thing you have to do **on Vercel** to deploy. Both are quick.

## The one thing you have to fix first

**Your `.env.local` `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are wrong.** They're 31-char strings. Real Supabase API keys are ~200+ char JWTs (start with `eyJ`) or `sb_publishable_...` / `sb_secret_...` for the newer key format. PostgREST returns `401 Invalid API key` for both.

`SUPABASE_DB_URL` is fine — that's how we applied the schema and synced the season data.

### Fix it

1. Open https://supabase.com/dashboard → your project → **Project Settings → API**.
2. Copy the **anon public** key (long JWT or `sb_publishable_...`) into `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Copy the **service_role** key (long JWT or `sb_secret_...`) into `SUPABASE_SERVICE_ROLE_KEY`. Keep it secret — server-side only.
4. Save `.env.local`. Restart `npm run dev` if it's running.

### Verify

```bash
node scripts/probe-supabase.mjs
```

Expected:
```
anon: OK rows=4 -> Lats, Horny, Shulks, Spenny
service: OK rows=4 -> Lats, Horny, Shulks, Spenny
```

## Try it locally

```bash
npm run dev
# http://localhost:3000
```

Walk-through:

1. `/` → tap **Lats** (commissioner).
2. `/admin` → Season `2024`, Round `1`, **Open draft for this round** (data's already there from last night's `sync:season`). Use ↑/↓ to set order if you want.
3. `/draft` → live board for Bahrain 2024. Pick away — all 20 driver slots across 5 rounds.
4. `/admin` again → **Close draft & score**.
5. `/standings` → 4 names ranked, lowest total leads.
6. Open in a second browser (or your phone on the same Wi-Fi) as a different player — picks broadcast live.

To test multiple races: from Admin, change Round to `2`, **Open draft**, repeat. Repeat for as many rounds as you want — every round of 2024 has both qualifying and results in the DB.

## Deploying to Vercel (10 minutes)

I couldn't do this myself because Vercel needs your login.

1. Push: `git push origin main` (14 commits ahead — see `git log --oneline 20a7ba3..HEAD`).
2. https://vercel.com → **New Project** → import `larsjohnston/FART-F1`. Framework auto-detects as Next.js.
3. **Environment Variables** (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL` — your project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the FIXED anon key
   - `SUPABASE_SERVICE_ROLE_KEY` — the FIXED service-role key
   - `F1_SEASON` — `2024` (or `2025` once Jolpica has 2025 data)
   - **Do NOT** add `SUPABASE_DB_URL` — that's a local-only bootstrap secret. The app doesn't use it.
4. Deploy. Open the production URL on your phone. Same walkthrough as local.

## What got built last night (commits, in order)

```
ecca580  chore: scaffold customization — Vitest, dark theme, bottom nav
d75b6fe  chore: rename package to fart-f1
c14cb26  feat: add DB schema, seed, Supabase clients, autonomous apply script
d592aa9  feat: add tested F1 data parsers for Jolpica + OpenF1
e518b55  feat: add F1 sync service, /api/sync route, and season backfill script
eaac7c2  chore: add Supabase REST key probe script
b747b0f  fix: surface malformed sync body as 400 not 500
dadaf44  feat: add tested golf-style scoring engine
67ae9c8  feat: add tested pure draft engine (straight order, on-behalf-of)
a688ebf  feat: add draft persistence + realtime service over the pure engine
cdbe6c3  feat: add pick-your-name entry + acting-as player context
95f55ea  feat: add live draft board with realtime picks and on-behalf-of
4c6349a  feat: add standings (golf scoring) and commissioner admin panel
```

(Plus the Task 11 README + MORNING.md commit, which is this one.)

## Test coverage

```
npm test  →  3 files, 14 tests passing
```

- `tests/f1/parse.test.ts` — 4 tests, real Jolpica + OpenF1 fixtures
- `tests/scoring/score.test.ts` — 3 tests, golf scoring
- `tests/draft/engine.test.ts` — 7 tests, straight-order + on-behalf-of + completion

Pure modules carry the tests; DB / UI integration tests were deliberately deferred per the plan (line 1278 — "Known M1 simplifications").

## Database state

Synced last night via `scripts/sync-season.mts`:

| Table | Rows |
| --- | --- |
| `players` | 4 (Lats, Horny, Shulks, Spenny) |
| `races` (2024) | 24 (all `status='complete'`) |
| `drivers` | 24 (20 regulars + 4 mid-season subs) |
| `constructors` | 10 |
| `qualifying` | 479 (24 × 20 − 1; Sargeant withdrew in China R3) |
| `results` | 479 |

To re-sync (idempotent — onConflict upserts): `npm run sync:season`. To sync a different season, edit `F1_SEASON` or pass it on the CLI: `npx tsx scripts/sync-season.mts 24 2025`.

## Known M1 simplifications

These were deferred deliberately, per the plan:

- Draft order is set manually per round in Admin. Auto-suggest from current standings via `computeOrder` is wired up in the engine but not auto-applied (M2 promotes it).
- Standings recomputes client-side from raw picks + results on every page load. No materialized table.
- No pick timer, no best-available advisor, no live team projection (all M3).
- No reactions / trash talk, no standings chart, no recap card (M4).
- No achievements, no web-push notifications (M5).

## If something looks broken

- **Empty home screen with no players to tap** → API keys are still wrong. Run `node scripts/probe-supabase.mjs`.
- **`/admin` says "Commissioner only."** → you're acting as a non-commish player. Go to `/`, tap **Lats**.
- **`/admin` Sync button shows `Error: Invalid API key`** → service-role key in `.env.local` (local) or Vercel env vars (prod) is still wrong.
- **`/draft` shows "No active draft."** → go to `/admin` and open one for the current round.
- **Pick fails with `<driver> already drafted`** → that driver was just picked by someone else (the engine's uniqueness check is doing its job). Refresh — the board updates via realtime.
- **Realtime not updating across devices** → check the Supabase dashboard → Database → Replication. The `picks` and `drafts` tables should be in the `supabase_realtime` publication. The migration added them via a guarded `DO $$` block; re-run `npm run db:apply` if you suspect it didn't apply.

Have fun.
