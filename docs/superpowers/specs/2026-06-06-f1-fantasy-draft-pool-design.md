# F1 Fantasy Draft Pool — Design Spec

**Date:** 2026-06-06
**Status:** Approved (design), pending implementation plan

## Context

The user runs a casual, season-long fantasy F1 pool for 4 players. Each race
weekend the players draft real F1 drivers; scoring mirrors official race
results. Today this is run informally; the goal is a fun, polished, mobile-first
web app where the 4 players can run their live draft, browse driver/constructor
data to inform picks, and follow the season-long championship. The user wants it
to feel like a real product, not a spreadsheet, and explicitly opted into a full
set of "fun" features.

## Rules of the pool (source of truth for the engine)

- **Field:** 20 drivers per race weekend.
- **Players:** 4. Each drafts **5 drivers** → all 20 drivers are drafted, none
  left over.
- **Draft pattern:** **straight order**, 1-2-3-4 repeating across all 5 rounds
  (the first picker picks first in every round).
- **Draft order per race:** derived from current cumulative standings —
  **the player doing worst (most points) picks first** (catch-up mechanic).
  - **Race 1:** no standings exist yet, so the **commissioner sets the order
    manually.**
  - Standings ties for ordering: broken by most-recent-race result, then by
    commissioner override.
- **Scoring:** after each race, each drafted driver scores points equal to their
  **official finishing position** (winner = 1, 2nd = 2, … 20th = 20). A player's
  weekly score = sum of their 5 drivers' finishing positions. **Lower is better**
  (golf-style). Scores accumulate across the whole season.
- **Draft timing:** the draft happens after qualifying — qualifying order is
  shown as decision-support info during the draft.

## Login & identity

- **No passwords.** A player taps their name to act as that player ("just pick
  your name").
- This intentionally allows **one player to pick on behalf of an absent
  player.** When the acting player differs from the on-the-clock player, the pick
  is stamped and displayed as *"<Actor> picked for <OnTheClock>"* on the board
  and in pick history.
- A lightweight **commissioner** role (the user) can: set race-1 order, manage
  the player list, undo/correct picks, toggle the pick timer, and trigger/redo a
  results sync.

## Draft mechanics

- **Live turn lock:** only the on-the-clock player's slot is active; the board
  reflects whose turn it is. Picks broadcast live to all 4 devices.
- **Pick timer (optional):** commissioner can enable a per-pick countdown. It is
  a visible nudge, not a hard auto-pick (no auto-skip in v1).
- **Best-available advisor:** the available-drivers list is sortable/rankable by
  season average finish, recent form (last N races), and current qualifying
  position.
- **Live team projection:** as a player drafts, show their team's projected
  weekend points based on qualifying order / season form, updating per pick.
- **Reactions & trash talk:** emoji reactions and a short message feed attached
  to picks.

## Architecture

**Stack:** Next.js (React, mobile-first) deployed on **Vercel**, with
**Supabase** (Postgres + Realtime + free tier) as the database and live-update
layer. Chosen for: free hosting with real URLs, SQL that fits the
standings/scoring math, and built-in realtime so the draft board updates
instantly across phones.

**Data flow:**

```
F1 APIs ──(sync job)──> Supabase (Postgres)
                              │  ▲
                  realtime    │  │ read/write
                              ▼  │
                    Next.js app on 4 phones
```

- The app reads from **our own database**, not the public APIs directly — fast,
  and resilient to API hiccups/rate limits.
- **Supabase Realtime** pushes each pick/reaction to all connected clients.

**External data sources:**

- **Jolpica API** (maintained Ergast successor): season schedule, qualifying
  results, race results, driver standings, constructor standings.
- **OpenF1 API**: driver headshots, team metadata for photos and stat pages.
- A **sync job** (scheduled daily + manually triggerable, and run post-race)
  upserts the latest data. Missing driver photo → fallback to a team-colored
  tile with the driver's initials.

## Components (units with clear boundaries)

- **Data sync service** — fetches Jolpica/OpenF1, normalizes, upserts into DB.
  Input: race/season; Output: rows in `drivers`, `constructors`, `races`,
  `qualifying`, `results`, `standings`. Independently testable against recorded
  API fixtures.
- **Scoring engine** — pure function: given a race's drivers→finishing-positions
  and the draft assignments, returns per-player weekly points and updated
  cumulative standings. No I/O, fully unit-testable.
- **Draft engine** — manages draft state machine: order computation, on-the-clock
  tracking, pick validation (turn lock + on-behalf-of), straight-order
  progression, completion. Emits events for realtime broadcast.
- **Projection/advisor module** — computes best-available rankings and live team
  projections from synced stats. Pure, testable.
- **Realtime layer** — Supabase channels for picks, reactions, draft state.
- **UI screens** — Draft, Standings, Drivers, Teams, Recap, Commissioner panel.
- **Achievements engine** — evaluates badge rules after each race.

## Data model (initial sketch)

- `players` (id, name, color, is_commissioner)
- `seasons`, `races` (round, name, date, status)
- `drivers` (id, name, code, number, headshot_url, constructor_id)
- `constructors` (id, name, color)
- `qualifying` (race_id, driver_id, position)
- `results` (race_id, driver_id, finish_position)
- `drafts` (race_id, status, timer_enabled, pick_order[])
- `picks` (draft_id, round, overall_pick, player_id, driver_id, actor_player_id,
  created_at)
- `standings` (season_id, player_id, cumulative_points) — derived/materialized
- `reactions` (pick_id, player_id, emoji, message)
- `achievements` (player_id, race_id, badge_key)

## Screens (bottom-tab nav, dark "Race Control" broadcast theme)

1. **Draft** — race header, on-the-clock + optional timer, your-turn highlight,
   available vs drafted drivers (team-color tinted, quali P-position shown),
   best-available advisor, live team projection, reactions + trash-talk feed,
   "<Actor> picked for <X>" stamps.
2. **Standings** — cumulative championship table, standings-over-time line chart,
   head-to-head, each player's current roster.
3. **Drivers** — all drivers with photos; tap → season stats modal (avg finish,
   wins, podiums, points, quali avg, recent form).
4. **Teams** — constructors' championship.
5. **Recap** — auto-generated post-race summary card (week winner, biggest mover,
   best/worst pick); shareable image.
6. **Commissioner panel** — set race-1 order, manage players, undo/correct picks,
   timer toggle, trigger sync.

## Fun features (all in scope, per user)

Best-available advisor · live team projection · pick timer · reactions & trash
talk · standings-over-time chart · achievements & badges · "your turn"
notifications (browser/push) · weekly recap card.

## Visual direction

**"Race Control"** — dark, high-contrast, broadcast-graphics feel; driver/team
accent colors; on-the-clock pick glows; drafted drivers struck through. Mobile
first.

## Testing strategy

- **Scoring engine & draft engine:** unit tests with fixtures (known race
  results → known standings; full 20-pick straight-order draft → correct
  assignments; on-behalf-of stamping; order-from-standings).
- **Data sync:** tests against recorded Jolpica/OpenF1 response fixtures
  (normalization + upsert idempotency).
- **Realtime/draft flow:** integration test simulating 4 clients drafting in
  turn, including an on-behalf-of pick and a commissioner undo.
- **Manual end-to-end:** deploy preview, run a mock draft on phone-sized
  viewport, verify live updates across two browser sessions.

## Out of scope (v1)

- Real authentication / passwords.
- Auto-skip when the pick timer expires (timer is a visual nudge only).
- Multi-pool / multi-league support (single pool, single active season).
- Native mobile apps (responsive web only; notifications via web push).

## Open items to confirm during planning

- Exact number of "recent form" races for the advisor (default: last 3).
- Whether weekly recap image is generated server-side or client-side.
- Achievement badge list (starter set vs. expanded).
