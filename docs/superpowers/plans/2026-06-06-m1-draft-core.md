# FART-F1 — Milestone 1: Draft Core (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed, mobile-first web app where the 4 players can run a complete live straight-order draft for a race using real F1 data, then see cumulative golf-style standings.

**Architecture:** Next.js (App Router, TypeScript, Tailwind) on Vercel, with Supabase (Postgres + Realtime) as the database and live-update layer. F1 data is pulled from Jolpica (Ergast-compatible) and OpenF1 by a sync service into our own DB; the app reads from the DB. Pure, unit-tested engines handle scoring and draft logic; Supabase persists state and broadcasts picks live to all devices.

**Tech Stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, Vitest, @supabase/supabase-js, Supabase Realtime, Vercel.

---

## Roadmap (this plan = Milestone 1 of 5)

Each milestone is independently shippable. Subsequent plans get written when we reach them.

- **M1 — Draft Core (this plan):** scaffold, DB, data sync, scoring + draft engines, entry/Draft/Standings screens, commissioner set-order + undo, deploy. Dark "Race Control" theme baseline.
- **M2 — Driver & Team data screens:** Drivers list with photos + season-stats modal; Teams (constructors') championship.
- **M3 — Smart draft aids:** best-available advisor (sort by avg finish / recent form / quali) + live team projection + optional pick timer.
- **M4 — Social & season flair:** reactions + trash-talk feed; standings-over-time chart; weekly recap card.
- **M5 — Engagement:** achievements & badges; "your turn" web-push notifications.

Reference spec: `docs/superpowers/specs/2026-06-06-f1-fantasy-draft-pool-design.md`.

---

## File Structure (Milestone 1)

```
FART-F1/
  package.json, tsconfig.json, next.config.mjs, tailwind.config.ts, vitest.config.ts
  .env.local.example
  supabase/
    migrations/0001_init.sql          # all M1 tables
    seed.sql                          # 4 players (commissioner = first)
  src/
    app/
      layout.tsx                      # dark theme shell + bottom tab nav
      globals.css                     # Tailwind + theme tokens
      page.tsx                        # entry: pick-your-name
      draft/page.tsx                  # live draft board
      standings/page.tsx              # cumulative standings + rosters
      admin/page.tsx                  # commissioner panel
      api/sync/route.ts               # POST: run data sync for a season/round
    lib/
      supabase/client.ts              # browser client
      supabase/server.ts              # server client (service role)
      f1/parse.ts                     # PURE: parse Jolpica + OpenF1 JSON
      f1/sync.ts                      # fetch + upsert into DB
      scoring/score.ts                # PURE: weekly + cumulative scoring
      draft/types.ts                  # shared draft types
      draft/engine.ts                 # PURE: order, on-the-clock, apply pick
      draft/service.ts                # DB persistence + realtime for drafts
      players/context.tsx             # "acting as" player React context
    components/
      DriverCard.tsx, OnTheClock.tsx, StandingsTable.tsx, BottomNav.tsx
  tests/
    f1/parse.test.ts
    scoring/score.test.ts
    draft/engine.test.ts
    fixtures/jolpica-qualifying.json, jolpica-results.json, openf1-drivers.json
```

**Boundaries:** `parse.ts`, `score.ts`, `engine.ts` are pure (no I/O) and carry the unit tests. `sync.ts` and `draft/service.ts` own all DB/realtime I/O. UI components are presentational; pages wire data + context.

---

## Task 0: Prerequisites (manual, one-time)

**No code.** These produce the credentials later tasks need. The implementing agent should pause and have the user (commissioner) do these, then paste values into `.env.local`.

- [ ] **Step 1: Create a Supabase project**
  - Go to https://supabase.com → New project (free tier). Region: closest to the players.
  - From Project Settings → API, copy: `Project URL`, `anon public` key, `service_role` key.

- [ ] **Step 2: Create a Vercel account**
  - https://vercel.com → sign in with the `larsjohnston` GitHub account (so it can deploy this repo).

- [ ] **Step 3: Record values for later**
  - Keep the three Supabase values handy for Task 1's `.env.local`. The `service_role` key is secret — it only ever goes in server env, never shipped to the browser.

---

## Task 1: Scaffold the app (Next.js + TS + Tailwind + Vitest + dark theme)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.local.example`
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Create: `src/components/BottomNav.tsx`

- [ ] **Step 1: Initialize the Next.js app in-place**

The repo already exists at `C:\Users\lars\FART-F1` with `main` checked out. Scaffold into it:

Run:
```bash
cd /c/Users/lars/FART-F1
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
```
Answer "Yes" to overwrite if prompted (only the empty repo + our docs exist; the `.gitignore` and `docs/` are preserved by create-next-app). If it refuses due to non-empty dir, scaffold in a temp dir and copy `src/`, config files over, keeping our `docs/`, `.gitignore`, `supabase/`.

- [ ] **Step 2: Add Vitest + testing deps**

Run:
```bash
cd /c/Users/lars/FART-F1
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
npm install @supabase/supabase-js
```

- [ ] **Step 3: Add `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom', globals: true, include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
})
```

- [ ] **Step 4: Add test script to `package.json`**

In `"scripts"`, add: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 5: Dark "Race Control" theme tokens**

Replace `src/app/globals.css` body/base with theme tokens (append after the Tailwind directives):
```css
:root {
  --bg: #0d1117; --panel: #11161d; --panel-2: #161b22; --line: #222a33;
  --text: #e8edf2; --muted: #8a93a0; --accent: #E8002D; --live: #19e36a; --warn: #ffd84d;
}
html, body { background: var(--bg); color: var(--text); }
body { font-family: system-ui, -apple-system, sans-serif; -webkit-tap-highlight-color: transparent; }
```

- [ ] **Step 6: App shell with bottom tab nav**

`src/app/layout.tsx`:
```tsx
import './globals.css'
import BottomNav from '@/components/BottomNav'
import { PlayerProvider } from '@/lib/players/context'

export const metadata = { title: 'FART-F1', description: 'Fantasy F1 draft pool' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ maxWidth: 520, margin: '0 auto', minHeight: '100dvh', paddingBottom: 64 }}>
        <PlayerProvider>{children}</PlayerProvider>
        <BottomNav />
      </body>
    </html>
  )
}
```

`src/components/BottomNav.tsx`:
```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/draft', label: 'Draft' },
  { href: '/standings', label: 'Standings' },
  { href: '/admin', label: 'Admin' },
]

export default function BottomNav() {
  const path = usePathname()
  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 520, margin: '0 auto',
      display: 'flex', background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
      {TABS.map(t => {
        const active = path.startsWith(t.href)
        return (
          <Link key={t.href} href={t.href} style={{ flex: 1, textAlign: 'center', padding: '11px 0',
            fontSize: 12, color: active ? 'var(--text)' : 'var(--muted)',
            borderTop: active ? '2px solid var(--accent)' : '2px solid transparent', textDecoration: 'none' }}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 7: `.env.local.example`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
F1_SEASON=2024
```
Then copy to `.env.local` and fill from Task 0. (`.env*` is already gitignored.)

- [ ] **Step 8: Verify it builds and dev-runs**

Run: `npm run build`
Expected: build completes with no type errors. Then `npm run dev` serves http://localhost:3000 with a dark page + bottom nav.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/lars/FART-F1 && git add -A
git commit -m "chore: scaffold Next.js app with dark theme, Vitest, Supabase deps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Database schema + Supabase clients

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/seed.sql`
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`

- [ ] **Step 1: Schema migration**

`supabase/migrations/0001_init.sql`:
```sql
create table players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#888',
  is_commissioner boolean not null default false,
  sort_order int not null default 0
);

create table constructors (
  id text primary key,            -- jolpica constructorId
  name text not null,
  color text not null default '#888'
);

create table drivers (
  id text primary key,            -- jolpica driverId
  code text,                      -- 3-letter (joins OpenF1 name_acronym)
  number int,
  given_name text, family_name text,
  constructor_id text references constructors(id),
  headshot_url text
);

create table races (
  id uuid primary key default gen_random_uuid(),
  season int not null, round int not null,
  name text not null, date date,
  status text not null default 'upcoming',   -- upcoming|drafting|complete
  unique (season, round)
);

create table qualifying (
  race_id uuid references races(id) on delete cascade,
  driver_id text references drivers(id),
  position int not null,
  primary key (race_id, driver_id)
);

create table results (
  race_id uuid references races(id) on delete cascade,
  driver_id text references drivers(id),
  finish_position int not null,
  primary key (race_id, driver_id)
);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade unique,
  status text not null default 'open',        -- open|complete
  pick_order uuid[] not null,                 -- 4 player ids, worst-first
  rounds int not null default 5
);

create table picks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade,
  overall int not null,                       -- 1..20
  round int not null,
  player_id uuid not null references players(id),     -- who gets the driver
  actor_id uuid not null references players(id),      -- who clicked
  driver_id text not null references drivers(id),
  created_at timestamptz not null default now(),
  unique (draft_id, overall),
  unique (draft_id, driver_id)
);

alter publication supabase_realtime add table picks;
alter publication supabase_realtime add table drafts;
```

- [ ] **Step 2: Seed players (commissioner = Lars)**

`supabase/seed.sql` — edit names/colors to the real 4 players:
```sql
insert into players (name, color, is_commissioner, sort_order) values
  ('Lars', '#E8002D', true,  0),
  ('Dave', '#27F4D2', false, 1),
  ('Sam',  '#FF8000', false, 2),
  ('Theo', '#64C4FF', false, 3)
on conflict (name) do nothing;
```

- [ ] **Step 3: Apply schema in Supabase**

In the Supabase dashboard → SQL Editor, paste and run `0001_init.sql`, then `seed.sql`. (CLI alternative: `npx supabase db push` if the user links the project later.)
Expected: tables created; `select count(*) from players;` returns 4.

- [ ] **Step 4: Supabase clients**

`src/lib/supabase/client.ts`:
```ts
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)
```
`src/lib/supabase/server.ts`:
```ts
import { createClient } from '@supabase/supabase-js'
export function serverClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add DB schema, seed, and Supabase clients

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: F1 data parsers (PURE, TDD)

**Files:**
- Create: `tests/fixtures/jolpica-qualifying.json`, `jolpica-results.json`, `openf1-drivers.json`
- Create: `tests/f1/parse.test.ts`
- Create: `src/lib/f1/parse.ts`

- [ ] **Step 1: Capture real fixtures**

Run (saves trimmed real responses as fixtures):
```bash
cd /c/Users/lars/FART-F1
curl -s "https://api.jolpi.ca/ergast/f1/2024/1/qualifying.json" -o tests/fixtures/jolpica-qualifying.json
curl -s "https://api.jolpi.ca/ergast/f1/2024/1/results.json" -o tests/fixtures/jolpica-results.json
curl -s "https://api.openf1.org/v1/drivers?session_key=latest" -o tests/fixtures/openf1-drivers.json
```

- [ ] **Step 2: Write failing tests**

`tests/f1/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import quali from '../fixtures/jolpica-qualifying.json'
import results from '../fixtures/jolpica-results.json'
import openf1 from '../fixtures/openf1-drivers.json'
import { parseQualifying, parseResults, parseDriversFromResults, parseOpenF1 } from '@/lib/f1/parse'

describe('parseQualifying', () => {
  it('returns 20 rows sorted by position with driverId + position', () => {
    const rows = parseQualifying(quali as any)
    expect(rows).toHaveLength(20)
    expect(rows[0]).toMatchObject({ driverId: 'max_verstappen', position: 1 })
    expect(rows.every(r => typeof r.position === 'number')).toBe(true)
  })
})

describe('parseResults', () => {
  it('returns finishing positions keyed by driverId', () => {
    const rows = parseResults(results as any)
    expect(rows).toHaveLength(20)
    expect(rows.find(r => r.driverId === 'max_verstappen')!.finishPosition).toBe(1)
  })
})

describe('parseDriversFromResults', () => {
  it('extracts driver + constructor metadata', () => {
    const { drivers, constructors } = parseDriversFromResults(results as any)
    expect(drivers.find(d => d.id === 'max_verstappen')).toMatchObject({ code: 'VER', constructorId: 'red_bull' })
    expect(constructors.find(c => c.id === 'red_bull')).toBeTruthy()
  })
})

describe('parseOpenF1', () => {
  it('maps acronym -> headshot + team colour', () => {
    const map = parseOpenF1(openf1 as any)
    expect(map['VER']?.headshotUrl).toContain('http')
    expect(map['VER']?.teamColour).toMatch(/^#/)
  })
})
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `parse.ts` module / exports not found.

- [ ] **Step 4: Implement `src/lib/f1/parse.ts`**

```ts
type Race = any
const race = (j: Race) => j.MRData.RaceTable.Races[0]

export function parseQualifying(j: Race) {
  return (race(j)?.QualifyingResults ?? []).map((q: any) => ({
    driverId: q.Driver.driverId as string,
    code: q.Driver.code as string,
    position: Number(q.position),
  })).sort((a: any, b: any) => a.position - b.position)
}

export function parseResults(j: Race) {
  return (race(j)?.Results ?? []).map((r: any) => ({
    driverId: r.Driver.driverId as string,
    finishPosition: Number(r.position),
  }))
}

export function parseDriversFromResults(j: Race) {
  const rows = race(j)?.Results ?? []
  const drivers = rows.map((r: any) => ({
    id: r.Driver.driverId as string,
    code: r.Driver.code as string,
    number: r.Driver.permanentNumber ? Number(r.Driver.permanentNumber) : null,
    givenName: r.Driver.givenName as string,
    familyName: r.Driver.familyName as string,
    constructorId: r.Constructor.constructorId as string,
  }))
  const cmap = new Map<string, { id: string; name: string }>()
  for (const r of rows) cmap.set(r.Constructor.constructorId, { id: r.Constructor.constructorId, name: r.Constructor.name })
  return { drivers, constructors: [...cmap.values()] }
}

export function parseOpenF1(arr: any[]) {
  const out: Record<string, { headshotUrl: string; teamColour: string; teamName: string }> = {}
  for (const d of arr) {
    if (!d.name_acronym) continue
    out[d.name_acronym] = {
      headshotUrl: d.headshot_url ?? '',
      teamColour: d.team_colour ? `#${d.team_colour}` : '#888',
      teamName: d.team_name ?? '',
    }
  }
  return out
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test`
Expected: PASS (4 tests). If fixture's row 0 differs, adjust the expected `driverId` to match the captured fixture (pole-sitter of 2024 Bahrain = `max_verstappen`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add tested F1 data parsers for Jolpica + OpenF1

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Sync service (fetch + upsert into DB)

**Files:**
- Create: `src/lib/f1/sync.ts`
- Create: `src/app/api/sync/route.ts`

- [ ] **Step 1: Implement sync**

`src/lib/f1/sync.ts`:
```ts
import { serverClient } from '@/lib/supabase/server'
import { parseQualifying, parseResults, parseDriversFromResults, parseOpenF1 } from './parse'

const JOLPICA = 'https://api.jolpi.ca/ergast/f1'

async function getJSON(url: string) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`)
  return res.json()
}

/** Sync one race round: drivers, constructors, qualifying, and results (if available). */
export async function syncRound(season: number, round: number) {
  const db = serverClient()

  const qualiJson = await getJSON(`${JOLPICA}/${season}/${round}/qualifying.json`)
  const raceMeta = qualiJson.MRData.RaceTable.Races[0]
  if (!raceMeta) throw new Error('no race for that round yet')

  // results may not exist before the race; tolerate 404-ish empty
  let resultsJson: any = null
  try { resultsJson = await getJSON(`${JOLPICA}/${season}/${round}/results.json`) } catch { /* not raced yet */ }

  const openf1 = parseOpenF1(await getJSON('https://api.openf1.org/v1/drivers?session_key=latest'))

  // race row
  const { data: raceRow } = await db.from('races').upsert(
    { season, round, name: raceMeta.raceName, date: raceMeta.date,
      status: resultsJson ? 'complete' : 'upcoming' },
    { onConflict: 'season,round' }).select().single()
  const raceId = raceRow!.id

  // drivers + constructors come from results if present, else from qualifying
  const driverSource = resultsJson ?? qualiJson
  const { drivers, constructors } = resultsJson
    ? parseDriversFromResults(resultsJson)
    : parseDriversFromResults({ MRData: { RaceTable: { Races: [{ Results:
        qualiJson.MRData.RaceTable.Races[0].QualifyingResults.map((q: any) => ({ ...q, Constructor: q.Constructor })) }] } } })

  await db.from('constructors').upsert(constructors.map(c => ({ id: c.id, name: c.name })), { onConflict: 'id' })
  await db.from('drivers').upsert(drivers.map(d => ({
    id: d.id, code: d.code, number: d.number,
    given_name: d.givenName, family_name: d.familyName, constructor_id: d.constructorId,
    headshot_url: openf1[d.code]?.headshotUrl ?? null,
  })), { onConflict: 'id' })
  // enrich constructor colours from OpenF1 (by any driver on the team)
  for (const d of drivers) {
    const col = openf1[d.code]?.teamColour
    if (col) await db.from('constructors').update({ color: col }).eq('id', d.constructorId)
  }

  // qualifying rows
  const q = parseQualifying(qualiJson)
  await db.from('qualifying').upsert(q.map(r => ({ race_id: raceId, driver_id: r.driverId, position: r.position })),
    { onConflict: 'race_id,driver_id' })

  // results rows (if raced)
  if (resultsJson) {
    const rr = parseResults(resultsJson)
    await db.from('results').upsert(rr.map(r => ({ race_id: raceId, driver_id: r.driverId, finish_position: r.finishPosition })),
      { onConflict: 'race_id,driver_id' })
  }
  return { raceId, raced: !!resultsJson, drivers: drivers.length }
}
```

- [ ] **Step 2: API route to trigger sync**

`src/app/api/sync/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { syncRound } from '@/lib/f1/sync'

export async function POST(req: NextRequest) {
  const { season, round } = await req.json()
  try {
    const out = await syncRound(Number(season), Number(round))
    return NextResponse.json({ ok: true, ...out })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message ?? e) }, { status: 400 })
  }
}
```

- [ ] **Step 3: Manually verify sync against the live DB**

With `.env.local` filled, run `npm run dev`, then:
```bash
curl -s -X POST localhost:3000/api/sync -H 'content-type: application/json' -d '{"season":2024,"round":1}'
```
Expected: `{"ok":true,"raceId":"...","raced":true,"drivers":20}`. In Supabase, `select count(*) from drivers` = 20 and `select count(*) from results` = 20.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add F1 sync service and /api/sync route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Scoring engine (PURE, TDD)

**Files:**
- Create: `tests/scoring/score.test.ts`, `src/lib/scoring/score.ts`

- [ ] **Step 1: Write failing tests**

`tests/scoring/score.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { scoreRace, addToCumulative } from '@/lib/scoring/score'

const results = [
  { driverId: 'a', finishPosition: 1 }, { driverId: 'b', finishPosition: 2 },
  { driverId: 'c', finishPosition: 3 }, { driverId: 'd', finishPosition: 4 },
]
describe('scoreRace', () => {
  it('sums finishing positions per player (lower is better)', () => {
    const picks = { p1: ['a', 'd'], p2: ['b', 'c'] }  // p1: 1+4=5, p2: 2+3=5
    expect(scoreRace(picks, results)).toEqual({ p1: 5, p2: 5 })
  })
  it('treats a missing result as 0 contribution', () => {
    expect(scoreRace({ p1: ['z'] }, results)).toEqual({ p1: 0 })
  })
})
describe('addToCumulative', () => {
  it('adds weekly totals onto the running season totals', () => {
    expect(addToCumulative({ p1: 10, p2: 7 }, { p1: 5, p2: 5 })).toEqual({ p1: 15, p2: 12 })
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- score`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/scoring/score.ts`**

```ts
export interface RaceResult { driverId: string; finishPosition: number }

export function scoreRace(picksByPlayer: Record<string, string[]>, results: RaceResult[]): Record<string, number> {
  const pos = new Map(results.map(r => [r.driverId, r.finishPosition]))
  const out: Record<string, number> = {}
  for (const [player, drivers] of Object.entries(picksByPlayer)) {
    out[player] = drivers.reduce((sum, d) => sum + (pos.get(d) ?? 0), 0)
  }
  return out
}

export function addToCumulative(season: Record<string, number>, week: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...season }
  for (const [player, pts] of Object.entries(week)) out[player] = (out[player] ?? 0) + pts
  return out
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- score`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add tested golf-style scoring engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Draft engine (PURE, TDD)

**Files:**
- Create: `src/lib/draft/types.ts`, `tests/draft/engine.test.ts`, `src/lib/draft/engine.ts`

- [ ] **Step 1: Types**

`src/lib/draft/types.ts`:
```ts
export interface DraftConfig { order: string[]; rounds: number }   // order = player ids, worst-first
export interface Pick { overall: number; round: number; playerId: string; driverId: string; actorId: string }
export interface DraftState { config: DraftConfig; picks: Pick[] }
export interface OnClock { overall: number; round: number; playerId: string }
```

- [ ] **Step 2: Write failing tests**

`tests/draft/engine.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeOrder, onClock, applyPick, isComplete } from '@/lib/draft/engine'

const order = ['p1', 'p2', 'p3', 'p4']
const cfg = { order, rounds: 5 }

describe('computeOrder', () => {
  it('worst (most points) picks first', () => {
    const standings = [{ playerId: 'p1', points: 50 }, { playerId: 'p2', points: 80 },
      { playerId: 'p3', points: 60 }, { playerId: 'p4', points: 70 }]
    expect(computeOrder(standings)).toEqual(['p2', 'p4', 'p3', 'p1'])
  })
})

describe('onClock (straight order)', () => {
  it('first pick is order[0], overall 1, round 1', () => {
    expect(onClock({ config: cfg, picks: [] })).toEqual({ overall: 1, round: 1, playerId: 'p1' })
  })
  it('pick 5 wraps to order[0] in round 2 (straight, not snake)', () => {
    const picks = Array.from({ length: 4 }, (_, i) => ({
      overall: i + 1, round: 1, playerId: order[i], driverId: `d${i}`, actorId: order[i] }))
    expect(onClock({ config: cfg, picks })).toEqual({ overall: 5, round: 2, playerId: 'p1' })
  })
  it('returns null when all 20 picks are in', () => {
    const picks = Array.from({ length: 20 }, (_, i) => ({
      overall: i + 1, round: Math.floor(i / 4) + 1, playerId: order[i % 4], driverId: `d${i}`, actorId: order[i % 4] }))
    expect(onClock({ config: cfg, picks })).toBeNull()
    expect(isComplete({ config: cfg, picks })).toBe(true)
  })
})

describe('applyPick', () => {
  it('assigns the driver to the on-clock player and records the actor', () => {
    const s = applyPick({ config: cfg, picks: [] }, 'max_verstappen', 'p3')  // p3 picks for p1
    expect(s.picks[0]).toMatchObject({ overall: 1, playerId: 'p1', actorId: 'p3', driverId: 'max_verstappen' })
  })
  it('rejects an already-drafted driver', () => {
    const s = applyPick({ config: cfg, picks: [] }, 'ver', 'p1')
    expect(() => applyPick(s, 'ver', 'p2')).toThrow(/already drafted/)
  })
  it('rejects picks once the draft is complete', () => {
    const picks = Array.from({ length: 20 }, (_, i) => ({
      overall: i + 1, round: Math.floor(i / 4) + 1, playerId: order[i % 4], driverId: `d${i}`, actorId: order[i % 4] }))
    expect(() => applyPick({ config: cfg, picks }, 'd99', 'p1')).toThrow(/complete/)
  })
})
```

- [ ] **Step 3: Run, verify fail**

Run: `npm test -- engine`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/draft/engine.ts`**

```ts
import type { DraftState, OnClock } from './types'

export function computeOrder(standings: { playerId: string; points: number }[]): string[] {
  return [...standings].sort((a, b) => b.points - a.points).map(s => s.playerId)
}

export function isComplete(state: DraftState): boolean {
  return state.picks.length >= state.config.order.length * state.config.rounds
}

export function onClock(state: DraftState): OnClock | null {
  if (isComplete(state)) return null
  const n = state.picks.length
  const size = state.config.order.length
  return { overall: n + 1, round: Math.floor(n / size) + 1, playerId: state.config.order[n % size] }
}

export function applyPick(state: DraftState, driverId: string, actorId: string): DraftState {
  const slot = onClock(state)
  if (!slot) throw new Error('draft is complete')
  if (state.picks.some(p => p.driverId === driverId)) throw new Error(`${driverId} already drafted`)
  return { ...state, picks: [...state.picks, { ...slot, driverId, actorId }] }
}
```

- [ ] **Step 5: Run, verify pass**

Run: `npm test -- engine`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add tested pure draft engine (straight order, on-behalf-of)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Draft persistence + realtime service

**Files:**
- Create: `src/lib/draft/service.ts`

- [ ] **Step 1: Implement service (DB read/write + realtime subscribe)**

`src/lib/draft/service.ts`:
```ts
'use client'
import { supabase } from '@/lib/supabase/client'
import { applyPick, onClock } from './engine'
import type { DraftState, Pick } from './types'

export interface DraftRow { id: string; race_id: string; status: string; pick_order: string[]; rounds: number }

export async function loadDraft(raceId: string): Promise<{ draft: DraftRow; state: DraftState } | null> {
  const { data: draft } = await supabase.from('drafts').select('*').eq('race_id', raceId).single()
  if (!draft) return null
  const { data: picks } = await supabase.from('picks').select('*').eq('draft_id', draft.id).order('overall')
  const state: DraftState = {
    config: { order: draft.pick_order, rounds: draft.rounds },
    picks: (picks ?? []).map(p => ({ overall: p.overall, round: p.round, playerId: p.player_id, driverId: p.driver_id, actorId: p.actor_id })),
  }
  return { draft, state }
}

/** Validate with the pure engine, then persist the new pick. Realtime broadcasts the insert. */
export async function makePick(draft: DraftRow, state: DraftState, driverId: string, actorId: string) {
  const next = applyPick(state, driverId, actorId)         // throws on illegal pick
  const p = next.picks[next.picks.length - 1]
  const { error } = await supabase.from('picks').insert({
    draft_id: draft.id, overall: p.overall, round: p.round,
    player_id: p.playerId, actor_id: p.actorId, driver_id: p.driverId,
  })
  if (error) throw error
  if (onClock(next) === null) await supabase.from('drafts').update({ status: 'complete' }).eq('id', draft.id)
}

export function subscribePicks(draftId: string, onChange: () => void) {
  const ch = supabase.channel(`draft-${draftId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'picks', filter: `draft_id=eq.${draftId}` }, onChange)
    .subscribe()
  return () => { supabase.removeChannel(ch) }
}

export async function undoLastPick(draftId: string) {
  const { data } = await supabase.from('picks').select('id,overall').eq('draft_id', draftId).order('overall', { ascending: false }).limit(1)
  if (data?.[0]) {
    await supabase.from('picks').delete().eq('id', data[0].id)
    await supabase.from('drafts').update({ status: 'open' }).eq('id', draftId)
  }
}
```

Note: the unique constraints on `picks (draft_id, overall)` and `(draft_id, driver_id)` are the server-side guard against two players picking at the same instant — the second insert fails, and that client re-loads state.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: add draft persistence + realtime service over the pure engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Entry screen — "pick your name" + acting-as context

**Files:**
- Create: `src/lib/players/context.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Player context (persists choice in localStorage)**

`src/lib/players/context.tsx`:
```tsx
'use client'
import { createContext, useContext, useEffect, useState } from 'react'

export interface Player { id: string; name: string; color: string; is_commissioner: boolean }
interface Ctx { actingAs: Player | null; setActingAs: (p: Player | null) => void }
const PlayerCtx = createContext<Ctx>({ actingAs: null, setActingAs: () => {} })

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [actingAs, setActingAs] = useState<Player | null>(null)
  useEffect(() => { const s = localStorage.getItem('actingAs'); if (s) setActingAs(JSON.parse(s)) }, [])
  useEffect(() => { if (actingAs) localStorage.setItem('actingAs', JSON.stringify(actingAs)) }, [actingAs])
  return <PlayerCtx.Provider value={{ actingAs, setActingAs }}>{children}</PlayerCtx.Provider>
}
export const usePlayer = () => useContext(PlayerCtx)
```

- [ ] **Step 2: Entry page lists players to tap**

`src/app/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { usePlayer, type Player } from '@/lib/players/context'

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([])
  const { actingAs, setActingAs } = usePlayer()
  const router = useRouter()
  useEffect(() => { supabase.from('players').select('*').order('sort_order').then(({ data }) => setPlayers(data ?? [])) }, [])
  return (
    <main style={{ padding: 20 }}>
      <div style={{ fontSize: 13, letterSpacing: 1, color: 'var(--accent)', fontWeight: 700 }}>FART-F1</div>
      <h1 style={{ fontSize: 24, marginTop: 4 }}>Who are you?</h1>
      <p style={{ color: 'var(--muted)' }}>Tap your name to start drafting.</p>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {players.map(p => (
          <button key={p.id} onClick={() => { setActingAs(p); router.push('/draft') }}
            style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--line)',
              background: 'var(--panel-2)', color: 'var(--text)', borderLeft: `4px solid ${p.color}`, fontSize: 16 }}>
            {p.name}{p.is_commissioner ? ' · 🏁 commish' : ''}
            {actingAs?.id === p.id ? ' ✓' : ''}
          </button>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verify**

Run `npm run dev`, open localhost:3000, tap a name → routed to `/draft`, choice persists on reload.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add pick-your-name entry + acting-as player context

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Draft screen (live board)

**Files:**
- Create: `src/components/DriverCard.tsx`, `src/components/OnTheClock.tsx`
- Create: `src/app/draft/page.tsx`

- [ ] **Step 1: DriverCard + OnTheClock components**

`src/components/DriverCard.tsx`:
```tsx
'use client'
export interface DriverVM {
  id: string; name: string; team: string; teamColor: string; quali?: number
  headshot?: string | null; drafted?: { byName: string } | null
}
export default function DriverCard({ d, canPick, onPick }: { d: DriverVM; canPick: boolean; onPick: () => void }) {
  const dim = !!d.drafted
  return (
    <button disabled={dim || !canPick} onClick={onPick}
      style={{ textAlign: 'left', padding: 10, borderRadius: 10, border: '1px solid var(--line)',
        borderLeft: `3px solid ${dim ? '#333' : d.teamColor}`, background: dim ? '#0e1217' : 'var(--panel-2)',
        color: dim ? '#555' : 'var(--text)', outline: canPick && !dim ? '2px solid var(--live)' : 'none',
        outlineOffset: -1, opacity: dim ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {d.headshot ? <img src={d.headshot} alt="" width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} />
          : <span style={{ width: 28, height: 28, borderRadius: '50%', background: d.teamColor, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#000' }}>{d.name.slice(0, 2)}</span>}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, textDecoration: dim ? 'line-through' : 'none' }}>{d.name}</div>
          <div style={{ fontSize: 11, color: dim ? '#555' : d.teamColor }}>
            {d.team}{d.quali ? ` · P${d.quali}` : ''}{d.drafted ? ` · ${d.drafted.byName}` : ''}
          </div>
        </div>
      </div>
    </button>
  )
}
```

`src/components/OnTheClock.tsx`:
```tsx
'use client'
export default function OnTheClock({ name, yours }: { name: string | null; yours: boolean }) {
  return (
    <div style={{ padding: '10px 14px', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: 8,
      borderBottom: '1px solid var(--line)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--live)', boxShadow: '0 0 8px var(--live)' }} />
      <span style={{ fontSize: 13 }}>{name ? <>On the clock: <b>{name}</b>{yours ? ' — your pick!' : ''}</> : 'Draft complete 🏁'}</span>
    </div>
  )
}
```

- [ ] **Step 2: Draft page wiring**

`src/app/draft/page.tsx`:
```tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import { loadDraft, makePick, subscribePicks, type DraftRow } from '@/lib/draft/service'
import { onClock } from '@/lib/draft/engine'
import type { DraftState } from '@/lib/draft/types'
import DriverCard, { type DriverVM } from '@/components/DriverCard'
import OnTheClock from '@/components/OnTheClock'

export default function DraftPage() {
  const { actingAs } = usePlayer()
  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [state, setState] = useState<DraftState | null>(null)
  const [drivers, setDrivers] = useState<DriverVM[]>([])
  const [players, setPlayers] = useState<Record<string, { name: string }>>({})
  const [raceName, setRaceName] = useState('')

  const refresh = useCallback(async () => {
    // active race = latest race with a draft row, status drafting/open
    const { data: race } = await supabase.from('races').select('*').eq('status', 'drafting').order('round', { ascending: false }).limit(1).single()
    if (!race) return
    setRaceName(race.name)
    const loaded = await loadDraft(race.id)
    if (!loaded) return
    setDraft(loaded.draft); setState(loaded.state)
    const { data: pl } = await supabase.from('players').select('id,name')
    setPlayers(Object.fromEntries((pl ?? []).map(p => [p.id, { name: p.name }])))
    const { data: drv } = await supabase.from('drivers').select('id,given_name,family_name,headshot_url,color:constructor_id, constructors(name,color)')
    const { data: q } = await supabase.from('qualifying').select('driver_id,position').eq('race_id', race.id)
    const qmap = new Map((q ?? []).map(r => [r.driver_id, r.position]))
    const takenBy = new Map(loaded.state.picks.map(p => [p.driverId, players[p.playerId]?.name ?? '']))
    setDrivers((drv ?? []).map((d: any) => ({
      id: d.id, name: `${d.given_name?.[0] ?? ''}. ${d.family_name}`, team: d.constructors?.name ?? '',
      teamColor: d.constructors?.color ?? '#888', headshot: d.headshot_url,
      quali: qmap.get(d.id), drafted: takenBy.has(d.id) ? { byName: takenBy.get(d.id)! } : null,
    })).sort((a, b) => (a.quali ?? 99) - (b.quali ?? 99)))
  }, [players])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { if (!draft) return; return subscribePicks(draft.id, refresh) }, [draft, refresh])

  if (!actingAs) return <main style={{ padding: 20 }}>Pick your name on the home screen first.</main>
  if (!state) return <main style={{ padding: 20 }}>No active draft. Commissioner can open one in Admin.</main>

  const slot = onClock(state)
  const onClockName = slot ? players[slot.playerId]?.name ?? null : null
  const yours = slot?.playerId === actingAs.id

  async function pick(driverId: string) {
    if (!draft || !state || !actingAs) return
    try { await makePick(draft, state, driverId, actingAs.id); await refresh() }
    catch (e: any) { alert(e.message); await refresh() }
  }

  return (
    <main>
      <div style={{ background: 'linear-gradient(90deg,#E8002D,#a80020)', padding: '12px 14px' }}>
        <div style={{ fontSize: 11, letterSpacing: 1, opacity: .85 }}>LIVE DRAFT</div>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{raceName}</div>
      </div>
      <OnTheClock name={onClockName} yours={yours} />
      {slot && !yours && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--warn)' }}>
        It's {onClockName}'s turn. You can still pick for them if they're away — it'll show as "picked by {actingAs.name}".</div>}
      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {drivers.map(d => <DriverCard key={d.id} d={d} canPick={!!slot} onPick={() => pick(d.id)} />)}
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verify live updates across two sessions**

Open `/draft` in two browser windows (different player names). Make a pick in one → it appears struck-through in the other within ~1s, and the on-the-clock advances. Picking for the on-clock player while acting as someone else records the actor (visible after M1 in pick history / on the card's "by" label).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add live draft board with realtime picks and on-behalf-of

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Standings screen + Admin (open draft, set order, undo)

**Files:**
- Create: `src/components/StandingsTable.tsx`, `src/app/standings/page.tsx`, `src/app/admin/page.tsx`

- [ ] **Step 1: Standings computed from results + picks across all complete races**

`src/app/standings/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { scoreRace, addToCumulative } from '@/lib/scoring/score'

export default function StandingsPage() {
  const [rows, setRows] = useState<{ name: string; points: number }[]>([])
  useEffect(() => { (async () => {
    const { data: players } = await supabase.from('players').select('id,name')
    const nameById = Object.fromEntries((players ?? []).map(p => [p.id, p.name]))
    const { data: races } = await supabase.from('races').select('id').eq('status', 'complete')
    let cumulative: Record<string, number> = {}
    for (const r of races ?? []) {
      const { data: draft } = await supabase.from('drafts').select('id').eq('race_id', r.id).single()
      if (!draft) continue
      const { data: picks } = await supabase.from('picks').select('player_id,driver_id').eq('draft_id', draft.id)
      const { data: results } = await supabase.from('results').select('driver_id,finish_position').eq('race_id', r.id)
      const byPlayer: Record<string, string[]> = {}
      for (const p of picks ?? []) (byPlayer[p.player_id] ??= []).push(p.driver_id)
      const week = scoreRace(byPlayer, (results ?? []).map(x => ({ driverId: x.driver_id, finishPosition: x.finish_position })))
      cumulative = addToCumulative(cumulative, week)
    }
    setRows(Object.entries(cumulative).map(([id, points]) => ({ name: nameById[id] ?? id, points }))
      .sort((a, b) => a.points - b.points))  // low = leader
  })() }, [])
  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Championship</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>Lowest total wins (golf scoring).</p>
      <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
        {rows.map((r, i) => (
          <div key={r.name} style={{ display: 'flex', padding: '10px 12px', background: 'var(--panel-2)',
            border: '1px solid var(--line)', borderRadius: 10 }}>
            <span style={{ width: 24, color: i === 0 ? 'var(--warn)' : 'var(--muted)' }}>{i + 1}</span>
            <span style={{ flex: 1, fontWeight: 700 }}>{r.name}</span>
            <span>{r.points}</span>
          </div>
        ))}
        {rows.length === 0 && <p style={{ color: 'var(--muted)' }}>No completed races scored yet.</p>}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Admin panel — open a draft for the synced race + set order + undo**

`src/app/admin/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { computeOrder } from '@/lib/draft/engine'
import { undoLastPick } from '@/lib/draft/service'
import { usePlayer } from '@/lib/players/context'

export default function AdminPage() {
  const { actingAs } = usePlayer()
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([])
  const [season, setSeason] = useState('2024'); const [round, setRound] = useState('1')
  const [order, setOrder] = useState<string[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => { supabase.from('players').select('id,name').order('sort_order').then(({ data }) => {
    setPlayers(data ?? []); setOrder((data ?? []).map(p => p.id)) }) }, [])

  if (!actingAs?.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  async function sync() {
    setMsg('Syncing…')
    const res = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ season: Number(season), round: Number(round) }) }).then(r => r.json())
    setMsg(res.ok ? `Synced ${res.drivers} drivers (raced: ${res.raced})` : `Error: ${res.error}`)
  }

  async function openDraft() {
    const { data: race } = await supabase.from('races').select('id').eq('season', Number(season)).eq('round', Number(round)).single()
    if (!race) { setMsg('Sync the round first.'); return }
    // race 1 uses the manual order set here; later races derive from standings (computeOrder) — for M1 we set manually each time
    await supabase.from('drafts').upsert({ race_id: race.id, pick_order: order, status: 'open', rounds: 5 }, { onConflict: 'race_id' })
    await supabase.from('races').update({ status: 'drafting' }).eq('id', race.id)
    setMsg('Draft opened. Players can pick on the Draft tab.')
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir; if (j < 0 || j >= order.length) return
    const next = [...order];[next[i], next[j]] = [next[j], next[i]]; setOrder(next)
  }
  const nameById = Object.fromEntries(players.map(p => [p.id, p.name]))

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Commissioner</h1>
      <section style={{ marginTop: 12 }}>
        <label>Season <input value={season} onChange={e => setSeason(e.target.value)} style={inp} /></label>{' '}
        <label>Round <input value={round} onChange={e => setRound(e.target.value)} style={inp} /></label>
        <div style={{ marginTop: 8 }}><button onClick={sync} style={btn}>Sync F1 data</button></div>
      </section>
      <section style={{ marginTop: 16 }}>
        <h3>Draft order (worst-placed first; you set race 1 manually)</h3>
        {order.map((id, i) => (
          <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6 }}>
            <span style={{ flex: 1 }}>{i + 1}. {nameById[id]}</span>
            <button onClick={() => move(i, -1)} style={btn}>↑</button>
            <button onClick={() => move(i, 1)} style={btn}>↓</button>
          </div>
        ))}
        <button onClick={openDraft} style={{ ...btn, marginTop: 8 }}>Open draft for this round</button>
      </section>
      <section style={{ marginTop: 16 }}>
        <button onClick={async () => {
          const { data: race } = await supabase.from('races').select('id').eq('season', Number(season)).eq('round', Number(round)).single()
          const { data: draft } = await supabase.from('drafts').select('id').eq('race_id', race!.id).single()
          if (draft) { await undoLastPick(draft.id); setMsg('Undid last pick.') }
        }} style={btn}>Undo last pick</button>
      </section>
      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}
const inp: React.CSSProperties = { width: 64, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, padding: 4 }
const btn: React.CSSProperties = { background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px' }
```

Note: M1 sets the order manually each round via this panel. `computeOrder` (already imported) gets wired to auto-suggest order from standings in M2 once multiple races exist; for M1 the commissioner can apply it by reading the Standings tab.

- [ ] **Step 3: Standings component extraction (optional tidy)**

If `standings/page.tsx` row markup is reused later, extract `src/components/StandingsTable.tsx`. For M1 inline is fine — skip if time-boxed.

- [ ] **Step 4: End-to-end verify on the live DB**

1. Admin → Sync season 2024 round 1 (raced=true). 2. Set order, Open draft. 3. Draft tab: complete all 20 picks across two browser sessions. 4. In Supabase set that race `status='complete'` (or add a "Close draft & score" button — see Step 5). 5. Standings tab shows 4 players ranked, lowest total first.

- [ ] **Step 5: Add "Close draft & score" to Admin**

Append to the Admin draft section a button that marks the race complete so Standings picks it up:
```tsx
<button onClick={async () => {
  const { data: race } = await supabase.from('races').select('id').eq('season', Number(season)).eq('round', Number(round)).single()
  await supabase.from('races').update({ status: 'complete' }).eq('id', race!.id)
  setMsg('Race closed & scored. Check Standings.')
}} style={{ ...btn, marginTop: 8 }}>Close draft &amp; score</button>
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add standings (golf scoring) and commissioner admin panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Deploy to Vercel

**Files:**
- Create: `README.md` (run/deploy notes)

- [ ] **Step 1: Push and import to Vercel**

```bash
git push origin main
```
In Vercel: New Project → import `larsjohnston/FART-F1`. Framework auto-detected (Next.js).

- [ ] **Step 2: Set environment variables in Vercel**

Add (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `F1_SEASON`. Values from Task 0.

- [ ] **Step 3: Deploy + smoke test on a phone**

Trigger deploy. Open the production URL on a phone: pick a name, see drivers, run a pick; confirm it appears on a second device live.

- [ ] **Step 4: README**

`README.md` with: what it is, local dev (`npm i`, `.env.local`, `npm run dev`), how to sync a round (Admin → Sync), how scoring works, link to spec + this plan.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: add README with run + deploy instructions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Self-Review (spec coverage)

- **Data via Jolpica + OpenF1** → Tasks 3–4 ✅ (verified shapes against live APIs)
- **4×5 straight-order draft, on-the-clock** → Task 6 engine + Task 9 board ✅
- **Worst-placed picks first / race-1 manual** → `computeOrder` (Task 6) + Admin manual order (Task 10) ✅ *(auto-from-standings suggestion deferred to M2)*
- **Live turn lock + pick-for-absent with actor stamp** → Tasks 6–9 (actor_id stored, "picked by" label) ✅
- **Golf-style cumulative scoring** → Task 5 + Standings (Task 10) ✅
- **No-password "tap your name"** → Task 8 ✅
- **Dark broadcast theme, mobile-first, bottom tabs** → Task 1 ✅
- **Commissioner: set order, undo, sync** → Task 10 ✅
- **Free hosted, phone-accessible** → Task 11 (Vercel + Supabase free tiers) ✅
- **Deferred to later milestones (explicitly):** Drivers/Teams screens (M2), best-available advisor + live projection + pick timer (M3), reactions/trash-talk + standings chart + recap card (M4), achievements + notifications (M5).

**Known M1 simplifications (intentional):** order is set manually each round (auto-suggestion in M2); scoring recomputed client-side on the Standings tab from raw picks+results (no materialized table needed at this scale); timer/advisor/projection not present yet.
