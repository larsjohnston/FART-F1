/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { CURRENT_SEASON } from '@/lib/config'

const JOLPICA = 'https://api.jolpi.ca/ergast/f1'
const round1 = (n: number) => Math.round(n * 10) / 10

async function getJSON(url: string) {
  const res = await fetch(url, { next: { revalidate: 600 } }) // cache 10 min
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json()
}

// A driver "finished" (was classified) if status is Finished / Lapped / "+N Lap(s)".
const isFinish = (status: string) => status === 'Finished' || status === 'Lapped' || /^\+/.test(status)

export async function GET(req: NextRequest) {
  const season = Number(req.nextUrl.searchParams.get('season') ?? CURRENT_SEASON)
  const round = Number(req.nextUrl.searchParams.get('round') ?? 0)
  try {
    // ---------- 1. Season results from Jolpica (grid + status + position) ----------
    const seasonRaces: any[] = []
    for (let offset = 0; offset < 800; offset += 100) {
      const j = await getJSON(`${JOLPICA}/${season}/results.json?limit=100&offset=${offset}`)
      const races = j.MRData.RaceTable.Races as any[]
      if (races?.length) seasonRaces.push(...races)
      if (offset + 100 >= Number(j.MRData.total)) break
    }

    type Fin = { round: number; finish: number; grid: number; status: string }
    type DAgg = { id: string; name: string; team: string; constructorId: string; fins: Fin[] }
    const dmap = new Map<string, DAgg>()
    for (const race of seasonRaces) {
      const rnd = Number(race.round)
      for (const r of race.Results ?? []) {
        const id = r.Driver.driverId
        if (!dmap.has(id)) {
          dmap.set(id, {
            id,
            name: `${r.Driver.givenName?.[0] ?? ''}. ${r.Driver.familyName}`,
            team: r.Constructor.name,
            constructorId: r.Constructor.constructorId,
            fins: [],
          })
        }
        dmap.get(id)!.fins.push({ round: rnd, finish: Number(r.position), grid: Number(r.grid), status: r.status })
      }
    }

    // ---------- 2. Track history (this circuit, last 3 seasons) ----------
    let circuitName = ''
    const trackAvg = new Map<string, { sum: number; n: number }>()
    if (round) {
      try {
        const rj = await getJSON(`${JOLPICA}/${season}/${round}.json`)
        const circuit = rj.MRData.RaceTable.Races[0]?.Circuit
        if (circuit) {
          circuitName = circuit.circuitName
          const years = [season - 1, season - 2, season - 3]
          const hist = await Promise.all(
            years.map(yr =>
              getJSON(`${JOLPICA}/${yr}/circuits/${circuit.circuitId}/results.json?limit=100`).catch(() => null),
            ),
          )
          for (const hj of hist) {
            const rs = hj?.MRData?.RaceTable?.Races?.[0]?.Results ?? []
            for (const r of rs) {
              const id = r.Driver.driverId
              const t = trackAvg.get(id) ?? { sum: 0, n: 0 }
              t.sum += Number(r.position)
              t.n += 1
              trackAvg.set(id, t)
            }
          }
        }
      } catch { /* track history is best-effort */ }
    }

    const drivers = [...dmap.values()]
      .map(d => {
        const fs = d.fins
        const n = fs.length
        const avgFinish = n ? fs.reduce((s, f) => s + f.finish, 0) / n : 0
        const retired = fs.filter(f => !isFinish(f.status)).length
        const gained = fs.filter(f => f.grid > 0)
        const posGained = gained.length ? gained.reduce((s, f) => s + (f.grid - f.finish), 0) / gained.length : 0
        const last3 = [...fs].sort((a, b) => b.round - a.round).slice(0, 3).map(f => f.finish)
        const th = trackAvg.get(d.id)
        return {
          id: d.id,
          name: d.name,
          team: d.team,
          constructorId: d.constructorId,
          races: n,
          avgFinish: round1(avgFinish),
          retiredPct: n ? Math.round((retired / n) * 100) : 0,
          posGained: round1(posGained),
          last3,
          poolPoints: fs.reduce((s, f) => s + f.finish, 0),
          trackAvg: th ? round1(th.sum / th.n) : null,
        }
      })
      .sort((a, b) => a.avgFinish - b.avgFinish)

    // ---------- 3. Player stats from our own picks + results ----------
    const db = serverClient()
    const [{ data: players }, { data: picksRaw }, { data: drafts }, { data: races }, { data: resultsRaw }, { data: driverRows }] =
      await Promise.all([
        db.from('players').select('id,name,color').order('sort_order'),
        db.from('picks').select('player_id,driver_id,draft_id'),
        db.from('drafts').select('id,race_id'),
        db.from('races').select('id,round,name').eq('season', season),
        db.from('results').select('race_id,driver_id,finish_position'),
        db.from('drivers').select('id,given_name,family_name'),
      ])

    const driverName = new Map((driverRows ?? []).map(d => [d.id, `${d.given_name?.[0] ?? ''}. ${d.family_name}`]))
    const draftRace = new Map((drafts ?? []).map(d => [d.id, d.race_id]))
    const seasonRaceIds = new Set((races ?? []).map(r => r.id))
    const picks = (picksRaw ?? []).filter(p => seasonRaceIds.has(draftRace.get(p.draft_id) ?? ''))
    const finishByKey = new Map((resultsRaw ?? []).map(r => [`${r.race_id}:${r.driver_id}`, r.finish_position]))

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
        id: pl.id, name: pl.name, color: pl.color,
        picks: mine.length,
        avgFinish: finN ? round1(finSum / finN) : null,
        topPicks,
        bogey: topPicks[0]?.name ?? null,
        best, worst,
        weeklyWins: 0,
      }
    })

    // weekly head-to-head wins: per race with picks + results, lowest week total wins
    const winsById = new Map<string, number>()
    for (const r of races ?? []) {
      const d = (drafts ?? []).find(x => x.race_id === r.id)
      if (!d) continue
      const totals = new Map<string, number>()
      let scored = false
      for (const p of picks.filter(p => p.draft_id === d.id)) {
        const fin = finishByKey.get(`${r.id}:${p.driver_id}`)
        if (typeof fin === 'number') { totals.set(p.player_id, (totals.get(p.player_id) ?? 0) + fin); scored = true }
      }
      if (!scored) continue
      const min = Math.min(...totals.values())
      for (const [pid, t] of totals) if (t === min) winsById.set(pid, (winsById.get(pid) ?? 0) + 1)
    }
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
