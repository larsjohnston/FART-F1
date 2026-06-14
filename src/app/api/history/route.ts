/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { CURRENT_SEASON } from '@/lib/config'
import { scoreRace } from '@/lib/scoring/score'

type SeasonBlock = { standings: any[]; races: { race_no: number; pts: Record<string, number> }[]; complete: boolean }

/** Live, in-progress season block (current season): entered prior-race points
 *  plus every in-app race that has results stored — provisional or official —
 *  scored with the pool rule, grouped by round. This is the same data the live
 *  Standings/Championship show, so History's current season tracks the latest
 *  race instead of the frozen spreadsheet import in archive_race_points. */
async function liveSeasonBlock(db: any, pl: any[], season: number): Promise<SeasonBlock> {
  const [{ data: prior }, { data: seasonRaces }] = await Promise.all([
    db.from('prior_race_points').select('round,player_id,points').eq('season', season),
    db.from('races').select('id,round').eq('season', season),
  ])
  const roundByRace = new Map<string, number>((seasonRaces ?? []).map((r: any) => [r.id, Number(r.round)]))
  const seasonRaceIds = (seasonRaces ?? []).map((r: any) => r.id)
  const { data: resultRows } = seasonRaceIds.length
    ? await db.from('results').select('race_id').in('race_id', seasonRaceIds)
    : { data: [] as any[] }
  const racesWithResults = [...new Set<string>((resultRows ?? []).map((r: any) => r.race_id as string))]

  // round -> { player_id -> points }
  const perRound = new Map<number, Record<string, number>>()
  const bump = (round: number, id: string, pts: number) => {
    const m = perRound.get(round) ?? {}
    m[id] = (m[id] ?? 0) + pts
    perRound.set(round, m)
  }

  for (const r of prior ?? []) bump(r.round, r.player_id, r.points)

  for (const raceId of racesWithResults) {
    const { data: draft } = await db.from('drafts').select('id,historic').eq('race_id', raceId).maybeSingle()
    if (!draft || draft.historic) continue // historic rounds are covered by prior_race_points
    const [{ data: picks }, { data: results }] = await Promise.all([
      db.from('picks').select('player_id,driver_id').eq('draft_id', draft.id),
      db.from('results').select('driver_id,finish_position').eq('race_id', raceId),
    ])
    const byPlayer: Record<string, string[]> = {}
    for (const p of picks ?? []) (byPlayer[p.player_id] ??= []).push(p.driver_id)
    const week = scoreRace(byPlayer, (results ?? []).map((x: any) => ({ driverId: x.driver_id, finishPosition: x.finish_position })))
    const round = roundByRace.get(raceId) ?? 0
    for (const [id, pts] of Object.entries(week)) bump(round, id, pts)
  }

  const tot: Record<string, number> = {}
  for (const p of pl) tot[p.id] = 0
  for (const m of perRound.values()) for (const [id, pts] of Object.entries(m)) tot[id] = (tot[id] ?? 0) + pts
  const standings = pl.map(p => ({ id: p.id, name: p.name, color: p.color, points: tot[p.id] ?? 0 }))
    .sort((a, b) => a.points - b.points)
  const races = [...perRound.keys()].sort((a, b) => a - b)
    .map(rn => ({ race_no: rn, pts: perRound.get(rn) as Record<string, number> }))
  return { standings, races, complete: false }
}

/** Aggregates the imported multi-season archive (2022-2026) for the History page:
 *  per-season standings + race-by-race points, and all-time career totals,
 *  titles, and each player's most-drafted driver. The current (in-progress)
 *  season is computed live from results rather than the archive so it stays in
 *  sync with the latest race. */
export async function GET() {
  const db = serverClient()
  const [{ data: players }, { data: rp }, { data: picks }] = await Promise.all([
    db.from('players').select('id,name,color').order('sort_order'),
    db.from('archive_race_points').select('season,race_no,player_id,points'),
    db.from('archive_picks').select('player_id,driver'),
  ])
  const pl = players ?? []
  // Show every archived season plus the current one (which may have no archive rows yet).
  const seasons = [...new Set([...(rp ?? []).map(r => r.season), CURRENT_SEASON])].sort((a, b) => a - b)

  const bySeason: Record<number, SeasonBlock> = {}
  for (const s of seasons) {
    if (s === CURRENT_SEASON) {
      // The in-progress season comes from live results, not the static archive.
      bySeason[s] = await liveSeasonBlock(db, pl, s)
      continue
    }
    const rows = (rp ?? []).filter(r => r.season === s)
    const tot: Record<string, number> = {}
    for (const p of pl) tot[p.id] = 0
    for (const r of rows) tot[r.player_id] = (tot[r.player_id] ?? 0) + r.points
    const standings = pl.map(p => ({ id: p.id, name: p.name, color: p.color, points: tot[p.id] ?? 0 }))
      .sort((a, b) => a.points - b.points)
    const raceNos = [...new Set(rows.map(r => r.race_no))].sort((a, b) => a - b)
    const races = raceNos.map(rn => {
      const pts: Record<string, number> = {}
      for (const r of rows.filter(x => x.race_no === rn)) pts[r.player_id] = r.points
      return { race_no: rn, pts }
    })
    bySeason[s] = { standings, races, complete: true }
  }

  // All-time: career totals + titles (completed seasons only) + favorite driver.
  const careerTot: Record<string, number> = {}
  const titles: Record<string, number> = {}
  for (const p of pl) { careerTot[p.id] = 0; titles[p.id] = 0 }
  for (const s of seasons) {
    const st = bySeason[s].standings
    for (const r of st) careerTot[r.id] += r.points
    if (bySeason[s].complete && st.length) {
      const min = st[0].points
      for (const r of st) if (r.points === min) titles[r.id] += 1
    }
  }
  const dc: Record<string, Record<string, number>> = {}
  for (const pk of picks ?? []) { (dc[pk.player_id] ??= {})[pk.driver] = (dc[pk.player_id][pk.driver] ?? 0) + 1 }
  const favorite: Record<string, { driver: string; count: number }> = {}
  for (const p of pl) {
    const top = Object.entries(dc[p.id] ?? {}).sort((a, b) => b[1] - a[1])[0]
    if (top) favorite[p.id] = { driver: top[0], count: top[1] }
  }
  const allTime = {
    totals: pl.map(p => ({ id: p.id, name: p.name, color: p.color, points: careerTot[p.id], titles: titles[p.id] }))
      .sort((a, b) => b.titles - a.titles || a.points - b.points),
    favorite,
  }

  return NextResponse.json({ ok: true, seasons, players: pl, bySeason, allTime })
}
