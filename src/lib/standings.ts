import { supabase } from '@/lib/supabase/client'
import { scoreRace } from '@/lib/scoring/score'
import { CURRENT_SEASON } from '@/lib/config'

export interface PoolStanding { id: string; points: number }

/**
 * Cumulative pool points per player for the season: entered prior-race points
 * (rounds 1-5) plus in-app scored races (complete, non-historic). Same math the
 * Championship standings use. Lower = leading.
 */
export async function computePoolStandings(playerIds: string[]): Promise<PoolStanding[]> {
  const cumulative: Record<string, number> = {}
  for (const id of playerIds) cumulative[id] = 0

  const { data: prior } = await supabase
    .from('prior_race_points').select('player_id,points').eq('season', CURRENT_SEASON)
  for (const r of prior ?? []) cumulative[r.player_id] = (cumulative[r.player_id] ?? 0) + r.points

  const { data: completeRaces } = await supabase
    .from('races').select('id').eq('status', 'complete').eq('season', CURRENT_SEASON)
  for (const r of completeRaces ?? []) {
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

/** Draft order = worst-placed first (most points), ties broken by the given order. */
export function draftOrderFromStandings(standings: PoolStanding[], tiebreak: string[]): string[] {
  const idx = new Map(tiebreak.map((id, i) => [id, i]))
  return [...standings]
    .sort((a, b) => b.points - a.points || ((idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0)))
    .map(s => s.id)
}
