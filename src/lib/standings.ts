import { supabase } from '@/lib/supabase/client'
import { scoreRace } from '@/lib/scoring/score'
import { CURRENT_SEASON } from '@/lib/config'

export interface PoolStanding { id: string; points: number }

/** This season's completed, non-historic races, oldest first. Shared by every
 *  cumulative-standings helper below so they agree on what counts as "a week". */
async function completeRaces(): Promise<{ id: string; round: number }[]> {
  const { data } = await supabase
    .from('races').select('id,round').eq('status', 'complete').eq('season', CURRENT_SEASON)
    .order('round', { ascending: true })
  return data ?? []
}

/** Cumulative pool points per player through the given races: entered
 *  prior-race points (rounds 1-5) plus each race scored with the pool rule,
 *  skipping `historic` drafts (those rounds are covered by prior_race_points
 *  instead). Lower = leading. */
async function cumulativeThrough(
  playerIds: string[],
  races: { id: string }[],
): Promise<PoolStanding[]> {
  const cumulative: Record<string, number> = {}
  for (const id of playerIds) cumulative[id] = 0

  const { data: prior } = await supabase
    .from('prior_race_points').select('player_id,points').eq('season', CURRENT_SEASON)
  for (const r of prior ?? []) cumulative[r.player_id] = (cumulative[r.player_id] ?? 0) + r.points

  for (const r of races) {
    const { data: draft } = await supabase.from('drafts').select('id,historic').eq('race_id', r.id).maybeSingle()
    if (!draft || draft.historic) continue
    const { data: picks } = await supabase.from('picks').select('player_id,driver_id').eq('draft_id', draft.id)
    const { data: results } = await supabase.from('results').select('driver_id,finish_position').eq('race_id', r.id)
    const byPlayer: Record<string, string[]> = {}
    for (const p of picks ?? []) (byPlayer[p.player_id] ??= []).push(p.driver_id)
    const week = scoreRace(byPlayer, (results ?? []).map(x => ({ driverId: x.driver_id, finishPosition: x.finish_position })))
    for (const [id, pts] of Object.entries(week)) cumulative[id] = (cumulative[id] ?? 0) + pts
  }

  return Object.entries(cumulative).map(([id, points]) => ({ id, points }))
}

/**
 * Cumulative pool points per player for the season: entered prior-race points
 * (rounds 1-5) plus in-app scored races (complete, non-historic). Same math the
 * Championship standings use. Lower = leading.
 */
export async function computePoolStandings(playerIds: string[]): Promise<PoolStanding[]> {
  return cumulativeThrough(playerIds, await completeRaces())
}

/**
 * Cumulative standings as of one round before the most recent completed race —
 * i.e. "going into" this week. Used only to break a draft-order tie: see
 * `draftOrderFromStandings`. Equal to `computePoolStandings` with no races at
 * all if fewer than two races have been completed yet.
 */
export async function computeStandingsBeforeLatestRound(playerIds: string[]): Promise<PoolStanding[]> {
  const races = await completeRaces()
  return cumulativeThrough(playerIds, races.slice(0, -1))
}

/**
 * Per-player points for the single most recent completed (non-historic) race —
 * the basis for "weekly loser drafts first". Returns zeros for everyone if no
 * in-app race has been scored yet (order then falls back to the tiebreak).
 */
export async function computeLastWeekStandings(playerIds: string[]): Promise<PoolStanding[]> {
  const cumulative: Record<string, number> = {}
  for (const id of playerIds) cumulative[id] = 0

  const { data: completeRaces } = await supabase
    .from('races').select('id,round').eq('status', 'complete').eq('season', CURRENT_SEASON)
    .order('round', { ascending: false })

  for (const r of completeRaces ?? []) {
    const { data: draft } = await supabase.from('drafts').select('id,historic').eq('race_id', r.id).maybeSingle()
    if (!draft || draft.historic) continue
    const { data: picks } = await supabase.from('picks').select('player_id,driver_id').eq('draft_id', draft.id)
    const { data: results } = await supabase.from('results').select('driver_id,finish_position').eq('race_id', r.id)
    const byPlayer: Record<string, string[]> = {}
    for (const p of picks ?? []) (byPlayer[p.player_id] ??= []).push(p.driver_id)
    const week = scoreRace(byPlayer, (results ?? []).map(x => ({ driverId: x.driver_id, finishPosition: x.finish_position })))
    for (const [id, pts] of Object.entries(week)) cumulative[id] = (cumulative[id] ?? 0) + pts
    break // most recent scored race only
  }

  return Object.entries(cumulative).map(([id, points]) => ({ id, points }))
}

/** Resolve the draft order for the configured basis (worst-placed picks first). */
export async function computeDraftOrder(
  playerIds: string[],
  basis: 'overall' | 'weekly',
): Promise<string[]> {
  if (basis === 'weekly') {
    return draftOrderFromStandings(await computeLastWeekStandings(playerIds), playerIds)
  }
  const [standings, priorStandings] = await Promise.all([
    computePoolStandings(playerIds),
    computeStandingsBeforeLatestRound(playerIds),
  ])
  return draftOrderFromStandings(standings, playerIds, priorStandings)
}

/**
 * Draft order = worst-placed first (most points). Ties are broken, in order:
 * 1. Whoever was **trailing** (more points) in `priorStandings` — the user's
 *    confirmed rule: two players tied after a week, the one who was behind
 *    going into that week drafts first — same catch-up logic as the
 *    worst-first order itself, just applied to the tied pair.
 * 2. The given fallback order, for the rare case that's *also* tied (or no
 *    prior standings were supplied, e.g. the 'weekly' basis).
 */
export function draftOrderFromStandings(
  standings: PoolStanding[],
  tiebreak: string[],
  priorStandings?: PoolStanding[],
): string[] {
  const idx = new Map(tiebreak.map((id, i) => [id, i]))
  const prior = new Map((priorStandings ?? []).map(s => [s.id, s.points]))
  return [...standings]
    .sort((a, b) =>
      b.points - a.points ||
      ((prior.get(b.id) ?? 0) - (prior.get(a.id) ?? 0)) ||
      ((idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0)))
    .map(s => s.id)
}
