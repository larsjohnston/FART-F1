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
      { data: archiveRP }, { data: archivePicks }, { data: priorRP },
    ] = await Promise.all([
      db.from('players').select('id,name,color,photo_url').order('sort_order'),
      db.from('picks').select('player_id,driver_id,draft_id'),
      db.from('drafts').select('id,race_id'),
      db.from('races').select('id,round,name').eq('season', season),
      db.from('results').select('race_id,driver_id,finish_position,grid,status'),
      db.from('qualifying').select('race_id,driver_id,position'),
      db.from('drivers').select('id,given_name,family_name,constructor_id'),
      db.from('constructors').select('id,name'),
      db.from('archive_race_points').select('season,race_no,player_id,points'),
      db.from('archive_picks').select('season,player_id,driver'),
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
    const finishByKey = new Map((resultsRaw ?? []).map(r => [`${r.race_id}:${r.driver_id}`, r.finish_position]))

    // ---------- Per-driver "FART Pts": season-long finishing-rank tally for
    // EVERY driver, drafted or not. Each race, rank the full classified field by
    // finishing position (winner = 1 … backmarker = N) and sum across the season.
    // Lower = consistently finishing near the front. ----------
    const poolPointsByDriver = new Map<string, number>()
    // ---------- Weekly wins/lasts + points per race: the POOL rule — drop
    // undrafted drivers, rank the drafted field; lowest weekly total wins,
    // highest is last. pointsById/racesScored give avg points per race. ----------
    const winsById = new Map<string, number>()   // weekly firsts (lifetime)
    const lastsById = new Map<string, number>()  // weekly lasts (lifetime)
    const pointsById = new Map<string, number>() // pool points (lifetime)
    const racesById = new Map<string, number>()  // races scored (lifetime, per player)
    const liveRounds = new Set<number>()         // current-season rounds counted from live drafts
    for (const r of races ?? []) {
      const finish = new Map<string, number>()
      for (const res of resultsRaw ?? []) if (res.race_id === r.id) finish.set(res.driver_id, res.finish_position)
      if (finish.size === 0) continue // not raced/scored yet

      // Full-field rank → every driver accumulates points this race.
      const fieldPts = rankDraftedPoints([...finish.keys()], finish)
      for (const [drv, pt] of fieldPts) poolPointsByDriver.set(drv, (poolPointsByDriver.get(drv) ?? 0) + pt)

      // Weekly win (drafted field only).
      const d = (drafts ?? []).find(x => x.race_id === r.id)
      if (!d) continue
      const racePicks = picks.filter(p => p.draft_id === d.id)
      const pts = rankDraftedPoints(racePicks.map(p => p.driver_id), finish)
      const totals = new Map<string, number>()
      for (const p of racePicks) {
        const pt = pts.get(p.driver_id)
        if (pt != null) totals.set(p.player_id, (totals.get(p.player_id) ?? 0) + pt)
      }
      if (totals.size) {
        liveRounds.add(r.round)
        const min = Math.min(...totals.values())
        const max = Math.max(...totals.values())
        for (const [pid, t] of totals) {
          racesById.set(pid, (racesById.get(pid) ?? 0) + 1)
          pointsById.set(pid, (pointsById.get(pid) ?? 0) + t)
          if (t === min) winsById.set(pid, (winsById.get(pid) ?? 0) + 1)
          // Only count a "last" when someone actually trailed (not an all-tie week).
          if (max > min && t === max) lastsById.set(pid, (lastsById.get(pid) ?? 0) + 1)
        }
      }
    }

    // Current-season rounds entered as prior points (played before the app, e.g.
    // a pool's back-filled rounds) feed the same weekly firsts/lasts/avg. Skip any
    // round already scored from a live draft above so it's never double-counted.
    const priorByRound = new Map<number, Map<string, number>>()
    for (const r of priorRP ?? []) {
      if (liveRounds.has(r.round)) continue
      const m = priorByRound.get(r.round) ?? new Map<string, number>()
      m.set(r.player_id, (m.get(r.player_id) ?? 0) + r.points)
      priorByRound.set(r.round, m)
    }
    for (const m of priorByRound.values()) {
      if (!m.size) continue
      const min = Math.min(...m.values())
      const max = Math.max(...m.values())
      for (const [pid, t] of m) {
        racesById.set(pid, (racesById.get(pid) ?? 0) + 1)
        pointsById.set(pid, (pointsById.get(pid) ?? 0) + t)
        if (t === min) winsById.set(pid, (winsById.get(pid) ?? 0) + 1)
        if (max > min && t === max) lastsById.set(pid, (lastsById.get(pid) ?? 0) + 1)
      }
    }

    // ---------- Lifetime (all years): fold the archive of completed past seasons
    // (2022–2025) into the live current season. The in-progress current season is
    // computed live above; archive rows for it (if any) are excluded to avoid
    // double-counting. ----------
    const archByRace = new Map<string, Map<string, number>>()      // `${season}:${race_no}` → player → points
    const archSeasonTotals = new Map<number, Map<string, number>>() // season → player → season total
    for (const r of archiveRP ?? []) {
      if (r.season >= CURRENT_SEASON) continue
      const rk = `${r.season}:${r.race_no}`
      const rm = archByRace.get(rk) ?? new Map<string, number>()
      rm.set(r.player_id, (rm.get(r.player_id) ?? 0) + r.points)
      archByRace.set(rk, rm)
      const sm = archSeasonTotals.get(r.season) ?? new Map<string, number>()
      sm.set(r.player_id, (sm.get(r.player_id) ?? 0) + r.points)
      archSeasonTotals.set(r.season, sm)
    }

    // Archive weekly firsts/lasts + points + race counts (per player).
    for (const rm of archByRace.values()) {
      if (!rm.size) continue
      const min = Math.min(...rm.values())
      const max = Math.max(...rm.values())
      for (const [pid, t] of rm) {
        racesById.set(pid, (racesById.get(pid) ?? 0) + 1)
        pointsById.set(pid, (pointsById.get(pid) ?? 0) + t)
        if (t === min) winsById.set(pid, (winsById.get(pid) ?? 0) + 1)
        if (max > min && t === max) lastsById.set(pid, (lastsById.get(pid) ?? 0) + 1)
      }
    }

    // FART championships: lowest season total wins each completed season; ties share.
    const championshipsById = new Map<string, number>()
    for (const totals of archSeasonTotals.values()) {
      if (!totals.size) continue
      const min = Math.min(...totals.values())
      for (const [pid, t] of totals) if (t === min) championshipsById.set(pid, (championshipsById.get(pid) ?? 0) + 1)
    }

    // Lifetime most-picked driver: combine archive picks (free-text family names,
    // mixed case) with this season's live picks, keyed by lower-cased family name.
    const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s)
    const familyById = new Map((driverRows ?? []).map(d => [d.id, d.family_name ?? '']))
    const pickFreqByPlayer = new Map<string, Map<string, { count: number; display: string }>>()
    const bumpPick = (playerId: string, family: string) => {
      const key = family.trim().toLowerCase()
      if (!key) return
      const fm = pickFreqByPlayer.get(playerId) ?? new Map<string, { count: number; display: string }>()
      const cur = fm.get(key) ?? { count: 0, display: titleCase(family.trim()) }
      cur.count += 1
      fm.set(key, cur)
      pickFreqByPlayer.set(playerId, fm)
    }
    for (const ap of archivePicks ?? []) {
      if (ap.season >= CURRENT_SEASON) continue
      bumpPick(ap.player_id, ap.driver ?? '')
    }
    for (const p of picks) bumpPick(p.player_id, familyById.get(p.driver_id) ?? '')

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
      const races = racesById.get(pl.id) ?? 0
      const lifeFreq = pickFreqByPlayer.get(pl.id)
      const mostPicked = lifeFreq && lifeFreq.size
        ? [...lifeFreq.values()].sort((a, b) => b.count - a.count)[0].display
        : null
      return {
        id: pl.id, name: pl.name, color: pl.color, photoUrl: pl.photo_url ?? null, picks: mine.length,
        avgFinish: finN ? round1(finSum / finN) : null,
        topPicks, bogey: topPicks[0]?.name ?? null, best, worst, weeklyWins: 0,
        avgPoints: races ? round1((pointsById.get(pl.id) ?? 0) / races) : null,
        mostPicked,
        firsts: winsById.get(pl.id) ?? 0,
        lasts: lastsById.get(pl.id) ?? 0,
        championships: championshipsById.get(pl.id) ?? 0,
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
