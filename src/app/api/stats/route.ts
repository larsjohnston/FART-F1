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
    ] = await Promise.all([
      db.from('players').select('id,name,color').order('sort_order'),
      db.from('picks').select('player_id,driver_id,draft_id'),
      db.from('drafts').select('id,race_id'),
      db.from('races').select('id,round,name').eq('season', season),
      db.from('results').select('race_id,driver_id,finish_position,grid,status'),
      db.from('qualifying').select('race_id,driver_id,position'),
      db.from('drivers').select('id,given_name,family_name,constructor_id'),
      db.from('constructors').select('id,name'),
    ])

    const roundByRace = new Map((races ?? []).map(r => [r.id, r.round]))
    const seasonRaceIds = new Set((races ?? []).map(r => r.id))
    const consName = new Map((cons ?? []).map(c => [c.id, c.name]))
    const driverName = new Map((driverRows ?? []).map(d => [d.id, `${d.given_name?.[0] ?? ''}. ${d.family_name}`]))
    const driverCons = new Map((driverRows ?? []).map(d => [d.id, d.constructor_id]))
    const qualiByKey = new Map((qualiRaw ?? []).map(q => [`${q.race_id}:${q.driver_id}`, q.position]))
    const draftRace = new Map((drafts ?? []).map(d => [d.id, d.race_id]))
    const picks = (picksRaw ?? []).filter(p => seasonRaceIds.has(draftRace.get(p.draft_id) ?? ''))
    const finishByKey = new Map((resultsRaw ?? []).map(r => [`${r.race_id}:${r.driver_id}`, r.finish_position]))

    // ---------- Pool scoring per race (THE rule): drop the undrafted drivers,
    // then rank the drafted field by finishing position (1 = best … N = worst). ----------
    const poolPointsByDriver = new Map<string, number>()
    const winsById = new Map<string, number>()
    for (const r of races ?? []) {
      const d = (drafts ?? []).find(x => x.race_id === r.id)
      if (!d) continue
      const racePicks = picks.filter(p => p.draft_id === d.id)
      const finish = new Map<string, number>()
      for (const res of resultsRaw ?? []) if (res.race_id === r.id) finish.set(res.driver_id, res.finish_position)
      if (finish.size === 0) continue // not raced/scored yet
      const pts = rankDraftedPoints(racePicks.map(p => p.driver_id), finish)
      for (const [drv, pt] of pts) poolPointsByDriver.set(drv, (poolPointsByDriver.get(drv) ?? 0) + pt)
      const totals = new Map<string, number>()
      for (const p of racePicks) {
        const pt = pts.get(p.driver_id)
        if (pt != null) totals.set(p.player_id, (totals.get(p.player_id) ?? 0) + pt)
      }
      if (totals.size) {
        const min = Math.min(...totals.values())
        for (const [pid, t] of totals) if (t === min) winsById.set(pid, (winsById.get(pid) ?? 0) + 1)
      }
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
        // retired % only if we have status data (null otherwise → shown as "–")
        const withStatus = fs.filter(f => f.status)
        const retiredPct = withStatus.length
          ? Math.round((withStatus.filter(f => !isFinish(f.status as string)).length / withStatus.length) * 100)
          : null
        return {
          id, name: driverName.get(id) ?? id,
          team: consName.get(driverCons.get(id) ?? '') ?? '',
          constructorId: driverCons.get(id) ?? '',
          races: n, avgFinish, retiredPct, posGained, last3, poolPoints,
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

    // ---------- Player stats (from our own picks + results) ----------
    const playerStats = (players ?? []).map(pl => {
      const mine = picks.filter(p => p.player_id === pl.id)
      const freq = new Map<string, number>()
      let finSum = 0, finN = 0
      let best: { driver: string; finish: number } | null = null
      let worst: { driver: string; finish: number } | null = null
      for (const p of mine) {
        freq.set(p.driver_id, (freq.get(p.driver_id) ?? 0) + 1)
        const fin = finishByKey.get(`${draftRace.get(p.draft_id)}:${p.driver_id}`)
        if (typeof fin === 'number') {
          finSum += fin; finN += 1
          if (!best || fin < best.finish) best = { driver: driverName.get(p.driver_id) ?? p.driver_id, finish: fin }
          if (!worst || fin > worst.finish) worst = { driver: driverName.get(p.driver_id) ?? p.driver_id, finish: fin }
        }
      }
      const topPicks = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([id, count]) => ({ name: driverName.get(id) ?? id, count }))
      return {
        id: pl.id, name: pl.name, color: pl.color, picks: mine.length,
        avgFinish: finN ? round1(finSum / finN) : null,
        topPicks, bogey: topPicks[0]?.name ?? null, best, worst, weeklyWins: 0,
      }
    })

    for (const ps of playerStats) ps.weeklyWins = winsById.get(ps.id) ?? 0

    const leagueFreq = new Map<string, number>()
    for (const p of picks) leagueFreq.set(p.driver_id, (leagueFreq.get(p.driver_id) ?? 0) + 1)
    const mostDrafted = [...leagueFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, count]) => ({ name: driverName.get(id) ?? id, count }))

    return NextResponse.json({ ok: true, circuitName, drivers, players: playerStats, mostDrafted })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 })
  }
}
