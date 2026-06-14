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

/** Current-season drafted picks (driver display name + that race's finishing
 *  position) from the live tables, for the career most-drafted + driver-award
 *  stats. Every draft for the season counts — including backfilled (historic)
 *  early rounds — since they're still real picks. */
async function liveSeasonPicks(db: any, season: number): Promise<{ player_id: string; driver: string; finish: number | null }[]> {
  const { data: races } = await db.from('races').select('id').eq('season', season)
  const raceIds = (races ?? []).map((r: any) => r.id as string)
  if (!raceIds.length) return []
  const { data: drafts } = await db.from('drafts').select('id,race_id').in('race_id', raceIds)
  const draftIds = (drafts ?? []).map((d: any) => d.id as string)
  if (!draftIds.length) return []
  const [{ data: picks }, { data: drv }, { data: results }] = await Promise.all([
    db.from('picks').select('player_id,driver_id,draft_id').in('draft_id', draftIds),
    db.from('drivers').select('id,given_name,family_name'),
    db.from('results').select('race_id,driver_id,finish_position').in('race_id', raceIds),
  ])
  const name = new Map<string, string>((drv ?? []).map((d: any) => [d.id, `${d.given_name ?? ''} ${d.family_name ?? ''}`.trim()]))
  const raceByDraft = new Map<string, string>((drafts ?? []).map((d: any) => [d.id, d.race_id]))
  const finishByKey = new Map<string, number>((results ?? []).map((r: any) => [`${r.race_id}:${r.driver_id}`, r.finish_position]))
  return (picks ?? []).map((p: any) => ({
    player_id: p.player_id,
    driver: name.get(p.driver_id) ?? p.driver_id,
    finish: finishByKey.get(`${raceByDraft.get(p.draft_id)}:${p.driver_id}`) ?? null,
  }))
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
    db.from('archive_picks').select('season,player_id,driver,finish'),
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
  // Career picks: historical picks from the archive (past seasons) plus the live
  // current-season picks, so 2026 reflects the real draft rather than the frozen
  // spreadsheet import. Live driver names use the full "Given Family" form to line
  // up with the archive's spreadsheet driver names.
  const livePicks = await liveSeasonPicks(db, CURRENT_SEASON)
  const dc: Record<string, Record<string, number>> = {}            // player -> driver -> times picked
  const dfin: Record<string, Record<string, { count: number; sum: number }>> = {} // player -> driver -> finish tally
  const tallyPick = (pid: string, driver: string, finish: number | null) => {
    ;(dc[pid] ??= {})[driver] = (dc[pid][driver] ?? 0) + 1
    if (finish != null) { const e = ((dfin[pid] ??= {})[driver] ??= { count: 0, sum: 0 }); e.count++; e.sum += finish }
  }
  for (const pk of picks ?? []) {
    if (pk.season === CURRENT_SEASON) continue // superseded by live current-season picks
    tallyPick(pk.player_id, pk.driver, pk.finish ?? null)
  }
  for (const pk of livePicks) tallyPick(pk.player_id, pk.driver, pk.finish)

  const favorite: Record<string, { driver: string; count: number }> = {}
  for (const p of pl) {
    const top = Object.entries(dc[p.id] ?? {}).sort((a, b) => b[1] - a[1])[0]
    if (top) favorite[p.id] = { driver: top[0], count: top[1] }
  }

  // Driver awards: among drivers a player drafted repeatedly (≥2×, else any), the
  // best (Golden Pick) and worst (Biggest Letdown) by average finishing position.
  const round1 = (n: number) => Math.round(n * 10) / 10
  const award = (pid: string, worst: boolean) => {
    const rows = Object.entries(dfin[pid] ?? {}).map(([driver, e]) => ({ driver, count: e.count, avg: e.sum / e.count }))
    if (!rows.length) return null
    const repeat = rows.filter(r => r.count >= 2)
    const pool = repeat.length ? repeat : rows
    pool.sort((a, b) => (worst ? b.avg - a.avg : a.avg - b.avg) || b.count - a.count)
    const t = pool[0]
    return { driver: t.driver, count: t.count, avg: round1(t.avg) }
  }
  const driverAwards: Record<string, { golden: any; letdown: any }> = {}
  for (const p of pl) driverAwards[p.id] = { golden: award(p.id, false), letdown: award(p.id, true) }

  // Weekly records, streaks and donkeys come from every week across all seasons,
  // in chronological order (season then race).
  const weeks: { season: number; race_no: number; pts: Record<string, number> }[] = []
  for (const s of seasons) for (const r of bySeason[s].races) weeks.push({ season: s, race_no: r.race_no, pts: r.pts })

  const pInfo = (id: string) => { const p = pl.find(x => x.id === id); return { id, name: p?.name ?? id, color: p?.color ?? '#888' } }

  const weeklyWins: Record<string, number> = {}
  const streakCur: Record<string, number> = {}
  const streakBest: Record<string, number> = {}
  for (const p of pl) { weeklyWins[p.id] = 0; streakCur[p.id] = 0; streakBest[p.id] = 0 }
  let bestWeek: any = null   // lowest single-player score
  let worstWeek: any = null  // highest single-player score
  for (const w of weeks) {
    const entries = Object.entries(w.pts)
    if (!entries.length) continue
    const min = Math.min(...entries.map(([, v]) => v))
    for (const [id, v] of entries) {
      if (v > 0 && (!bestWeek || v < bestWeek.points)) bestWeek = { ...pInfo(id), season: w.season, race_no: w.race_no, points: v }
      if (!worstWeek || v > worstWeek.points) worstWeek = { ...pInfo(id), season: w.season, race_no: w.race_no, points: v }
    }
    for (const p of pl) {
      const v = w.pts[p.id]
      if (v !== undefined && v === min) { streakCur[p.id]++; weeklyWins[p.id]++; streakBest[p.id] = Math.max(streakBest[p.id], streakCur[p.id]) }
      else streakCur[p.id] = 0
    }
  }

  // Donkey (wooden spoon): finishing last in a completed season.
  const donkeys: Record<string, number> = {}
  for (const p of pl) donkeys[p.id] = 0
  let titleBiggest: any = null, titleClosest: any = null
  for (const s of seasons) {
    const blk = bySeason[s]
    if (!blk.complete || blk.standings.length < 2) continue
    const max = Math.max(...blk.standings.map((r: any) => r.points))
    for (const r of blk.standings) if (r.points === max) donkeys[r.id] += 1
    const margin = blk.standings[1].points - blk.standings[0].points
    const rec = { season: s, leader: pInfo(blk.standings[0].id), runnerUp: pInfo(blk.standings[1].id), margin }
    if (!titleBiggest || margin > titleBiggest.margin) titleBiggest = rec
    if (!titleClosest || margin < titleClosest.margin) titleClosest = rec
  }

  const allTime = {
    totals: pl.map(p => ({ id: p.id, name: p.name, color: p.color, points: careerTot[p.id], titles: titles[p.id] }))
      .sort((a, b) => b.titles - a.titles || a.points - b.points),
    favorite,
  }
  const stats = {
    weeklyWins: pl.map(p => ({ ...pInfo(p.id), wins: weeklyWins[p.id] })).sort((a, b) => b.wins - a.wins),
    streaks: pl.map(p => ({ ...pInfo(p.id), streak: streakBest[p.id] })).sort((a, b) => b.streak - a.streak),
    donkeys: pl.map(p => ({ ...pInfo(p.id), count: donkeys[p.id] })).sort((a, b) => b.count - a.count),
    bestWeek, worstWeek, titleBiggest, titleClosest, driverAwards,
  }

  return NextResponse.json({ ok: true, seasons, players: pl, bySeason, allTime, stats })
}
