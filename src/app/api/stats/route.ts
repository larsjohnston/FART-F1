/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { CURRENT_SEASON } from '@/lib/config'
import { rankDraftedPoints } from '@/lib/scoring/score'

const JOLPICA = 'https://api.jolpi.ca/ergast/f1'
const round1 = (n: number) => Math.round(n * 10) / 10
const isFinish = (s: string) => s === 'Finished' || s === 'Lapped' || /^\+/.test(s)

// Time-boxed fetch — a slow/dead Jolpica must never hang the whole route.
async function getJSON(url: string, ms = 4000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal, next: { revalidate: 600 } })
    if (!res.ok) throw new Error(`${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

export async function GET(req: NextRequest) {
  const season = Number(req.nextUrl.searchParams.get('season') ?? CURRENT_SEASON)
  const round = Number(req.nextUrl.searchParams.get('round') ?? 0)
  try {
    const db = serverClient()
    const [
      { data: players }, { data: picksRaw }, { data: drafts }, { data: races },
      { data: resultsRaw }, { data: qualiRaw }, { data: driverRows }, { data: cons },
      { data: priorRP },
    ] = await Promise.all([
      db.from('players').select('id,name,color,photo_url').order('sort_order'),
      db.from('picks').select('player_id,driver_id,draft_id'),
      db.from('drafts').select('id,race_id'),
      db.from('races').select('id,round,name').eq('season', season),
      db.from('results').select('race_id,driver_id,finish_position,grid,status'),
      db.from('qualifying').select('race_id,driver_id,position'),
      db.from('drivers').select('id,given_name,family_name,constructor_id'),
      db.from('constructors').select('id,name'),
      db.from('prior_race_points').select('round,player_id,points').eq('season', CURRENT_SEASON),
    ])

    const roundByRace = new Map((races ?? []).map(r => [r.id, r.round]))
    const seasonRaceIds = new Set((races ?? []).map(r => r.id))
    const consName = new Map((cons ?? []).map(c => [c.id, c.name]))
    const driverName = new Map((driverRows ?? []).map(d => [d.id, `${d.given_name?.[0] ?? ''}. ${d.family_name}`]))
    const driverCons = new Map((driverRows ?? []).map(d => [d.id, d.constructor_id]))
    const qualiByKey = new Map((qualiRaw ?? []).map(q => [`${q.race_id}:${q.driver_id}`, q.position]))
    const draftRace = new Map((drafts ?? []).map(d => [d.id, d.race_id]))
    const picks = (picksRaw ?? []).filter(p => seasonRaceIds.has(draftRace.get(p.draft_id) ?? ''))

    // ---------- Per-driver "FART Pts": season-long finishing-rank tally for
    // EVERY driver, drafted or not. Each race, rank the full classified field by
    // finishing position (winner = 1 … backmarker = N) and sum across the season.
    // Lower = consistently finishing near the front. ----------
    const poolPointsByDriver = new Map<string, number>()
    // ---------- Current-season weekly totals per player. Each scored race (a
    // draft's picks scored by the pool rule) or back-filled prior round yields one
    // week's per-player totals. The Players tab is CURRENT SEASON only; History
    // covers all seasons. ----------
    const weeks: Record<string, number>[] = []
    const liveRounds = new Set<number>()
    for (const r of races ?? []) {
      const finish = new Map<string, number>()
      for (const res of resultsRaw ?? []) if (res.race_id === r.id) finish.set(res.driver_id, res.finish_position)
      if (finish.size === 0) continue // not raced/scored yet

      // Full-field rank → every driver accumulates FART Pts this race.
      const fieldPts = rankDraftedPoints([...finish.keys()], finish)
      for (const [drv, pt] of fieldPts) poolPointsByDriver.set(drv, (poolPointsByDriver.get(drv) ?? 0) + pt)

      const d = (drafts ?? []).find(x => x.race_id === r.id)
      if (!d) continue
      const racePicks = picks.filter(p => p.draft_id === d.id)
      const pts = rankDraftedPoints(racePicks.map(p => p.driver_id), finish)
      const totals: Record<string, number> = {}
      for (const p of racePicks) {
        const pt = pts.get(p.driver_id)
        if (pt != null) totals[p.player_id] = (totals[p.player_id] ?? 0) + pt
      }
      if (Object.keys(totals).length) { liveRounds.add(r.round); weeks.push(totals) }
    }
    // Back-filled prior rounds (points-only), skipping any round already scored live.
    const priorByRound = new Map<number, Record<string, number>>()
    for (const r of priorRP ?? []) {
      if (liveRounds.has(r.round)) continue
      const m = priorByRound.get(r.round) ?? {}
      m[r.player_id] = (m[r.player_id] ?? 0) + r.points
      priorByRound.set(r.round, m)
    }
    for (const m of priorByRound.values()) if (Object.keys(m).length) weeks.push(m)

    // Most-picked driver — current-season picks only.
    const pickFreqByPlayer = new Map<string, Map<string, number>>()
    for (const p of picks) {
      const nm = driverName.get(p.driver_id) ?? p.driver_id
      const fm = pickFreqByPlayer.get(p.player_id) ?? new Map<string, number>()
      fm.set(nm, (fm.get(nm) ?? 0) + 1)
      pickFreqByPlayer.set(p.player_id, fm)
    }

    // ---------- Driver stats (from our own DB) ----------
    type Fin = { round: number; finish: number; grid: number | null; status: string | null; quali: number | null }
    const byDriver = new Map<string, Fin[]>()
    for (const r of resultsRaw ?? []) {
      if (!seasonRaceIds.has(r.race_id)) continue
      const arr = byDriver.get(r.driver_id) ?? []
      arr.push({
        round: roundByRace.get(r.race_id) ?? 0,
        finish: r.finish_position,
        grid: r.grid ?? null,
        status: r.status ?? null,
        quali: qualiByKey.get(`${r.race_id}:${r.driver_id}`) ?? null,
      })
      byDriver.set(r.driver_id, arr)
    }

    const drivers = [...byDriver.entries()]
      .map(([id, fs]) => {
        const n = fs.length
        const avgFinish = round1(fs.reduce((s, f) => s + f.finish, 0) / n)
        const last3 = [...fs].sort((a, b) => b.round - a.round).slice(0, 3).map(f => f.finish)
        const poolPoints = poolPointsByDriver.get(id) ?? 0
        // positions gained: prefer real grid, fall back to qualifying position
        const gainable = fs
          .map(f => ({ start: f.grid && f.grid > 0 ? f.grid : f.quali, finish: f.finish }))
          .filter(x => typeof x.start === 'number')
        const posGained = gainable.length
          ? round1(gainable.reduce((s, x) => s + ((x.start as number) - x.finish), 0) / gainable.length)
          : 0
        // DNFs as a count over the races we have status for (e.g. 1/6).
        const withStatus = fs.filter(f => f.status)
        const retired = withStatus.filter(f => !isFinish(f.status as string)).length
        return {
          id, name: driverName.get(id) ?? id,
          team: consName.get(driverCons.get(id) ?? '') ?? '',
          constructorId: driverCons.get(id) ?? '',
          races: n, avgFinish, retired, retiredOf: withStatus.length, posGained, last3, poolPoints,
          trackAvg: null as number | null,
        }
      })
      .sort((a, b) => a.avgFinish - b.avgFinish)

    // ---------- Track history: best-effort Jolpica (never fatal) ----------
    let circuitName = ''
    if (round) {
      try {
        const rj = await getJSON(`${JOLPICA}/${season}/${round}.json`, 4000)
        const circuit = rj.MRData.RaceTable.Races[0]?.Circuit
        if (circuit) {
          circuitName = circuit.circuitName
          const hist = await Promise.all(
            [season - 1, season - 2, season - 3].map(yr =>
              getJSON(`${JOLPICA}/${yr}/circuits/${circuit.circuitId}/results.json?limit=100`, 4000).catch(() => null),
            ),
          )
          const t = new Map<string, { sum: number; n: number }>()
          for (const hj of hist) {
            for (const r of hj?.MRData?.RaceTable?.Races?.[0]?.Results ?? []) {
              const id = r.Driver.driverId
              const cur = t.get(id) ?? { sum: 0, n: 0 }
              cur.sum += Number(r.position); cur.n += 1; t.set(id, cur)
            }
          }
          for (const d of drivers) {
            const th = t.get(d.id)
            if (th) d.trackAvg = round1(th.sum / th.n)
          }
        }
      } catch { /* Jolpica down/slow — drivers + players still render */ }
    }

    // ---------- Player stats — CURRENT SEASON, from the weekly totals above ----------
    const playerStats = (players ?? []).map(pl => {
      const myWeeks = weeks.map(w => w[pl.id]).filter((v): v is number => typeof v === 'number')
      const n = myWeeks.length
      const avgPoints = n ? round1(myWeeks.reduce((s, x) => s + x, 0) / n) : null
      const bestWeek = n ? Math.min(...myWeeks) : null   // lowest weekly total (golf = best)
      const worstWeek = n ? Math.max(...myWeeks) : null
      // Weekly finishing position each week (competition rank; ties share the
      // better place). positions[0]=1sts … positions[3]=4ths.
      const positions = [0, 0, 0, 0]
      for (const w of weeks) {
        const mine = w[pl.id]
        if (typeof mine !== 'number') continue
        const rank = 1 + Object.values(w).filter(v => v < mine).length
        if (rank >= 1 && rank <= 4) positions[rank - 1]++
      }
      const fm = pickFreqByPlayer.get(pl.id)
      const mostPicked = fm && fm.size ? [...fm.entries()].sort((a, b) => b[1] - a[1])[0][0] : null
      return {
        id: pl.id, name: pl.name, color: pl.color, photoUrl: pl.photo_url ?? null,
        avgPoints, bestWeek, worstWeek, mostPicked, positions,
      }
    })

    const leagueFreq = new Map<string, number>()
    for (const p of picks) leagueFreq.set(p.driver_id, (leagueFreq.get(p.driver_id) ?? 0) + 1)
    const mostDrafted = [...leagueFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, count]) => ({ name: driverName.get(id) ?? id, count }))

    return NextResponse.json({ ok: true, circuitName, drivers, players: playerStats, mostDrafted })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 })
  }
}
