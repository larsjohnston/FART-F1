/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { CURRENT_SEASON } from '@/lib/config'
import { TEAM_COLORS } from '@/lib/f1/teamColors'

const JOLPICA = 'https://api.jolpi.ca/ergast/f1'

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

/** F1 drivers' + constructors' championship standings. Jolpica is the source of
 *  truth; if it's down each falls back to ranking by season average finish from
 *  our own DB. Powers the before-qualifying draft board and the Draft tab's
 *  default championship view. */
export async function GET(req: NextRequest) {
  const season = Number(req.nextUrl.searchParams.get('season') ?? CURRENT_SEASON)
  const db = serverClient()

  const [dj, cj] = await Promise.all([
    getJSON(`${JOLPICA}/${season}/driverStandings.json`).catch(() => null),
    getJSON(`${JOLPICA}/${season}/constructorStandings.json`).catch(() => null),
  ])

  // DB pull — for the fallbacks and for names/colors.
  const [{ data: races }, { data: results }, { data: drv }, { data: cons }] = await Promise.all([
    db.from('races').select('id').eq('season', season),
    db.from('results').select('race_id,driver_id,finish_position'),
    db.from('drivers').select('id,given_name,family_name,constructor_id'),
    db.from('constructors').select('id,name'),
  ])
  const seasonRaceIds = new Set((races ?? []).map(r => r.id))
  const consName = new Map((cons ?? []).map(c => [c.id, c.name]))
  const driverInfo = new Map((drv ?? []).map(d => [d.id, {
    name: `${d.given_name?.[0] ?? ''}. ${d.family_name}`, constructorId: d.constructor_id,
  }]))
  const seasonResults = (results ?? []).filter(r => seasonRaceIds.has(r.race_id))

  // ---------- Drivers ----------
  let drivers: any[]
  let driversSource: string
  const ds = dj?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
  if (ds.length) {
    driversSource = 'championship'
    drivers = ds.map((s: any, i: number) => ({
      id: s.Driver.driverId,
      name: `${s.Driver.givenName?.[0] ?? ''}. ${s.Driver.familyName}`,
      team: s.Constructors?.[s.Constructors.length - 1]?.name ?? '',
      constructorId: s.Constructors?.[s.Constructors.length - 1]?.constructorId ?? '',
      champPos: s.position ? Number(s.position) : i + 1,
      points: Number(s.points ?? 0),
    }))
  } else {
    driversSource = 'avg-finish'
    const agg = new Map<string, { sum: number; n: number }>()
    for (const r of seasonResults) {
      const a = agg.get(r.driver_id) ?? { sum: 0, n: 0 }
      a.sum += r.finish_position; a.n += 1; agg.set(r.driver_id, a)
    }
    drivers = [...agg.entries()]
      .map(([id, a]) => ({
        id, name: driverInfo.get(id)?.name ?? id,
        team: consName.get(driverInfo.get(id)?.constructorId ?? '') ?? '',
        constructorId: driverInfo.get(id)?.constructorId ?? '',
        champPos: 0, points: null, avgFinish: a.sum / a.n,
      }))
      .sort((a, b) => a.avgFinish - b.avgFinish)
      .map((d, i) => ({ ...d, champPos: i + 1 }))
  }

  // ---------- Constructors ----------
  let constructors: any[]
  let consSource: string
  const cs = cj?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []
  if (cs.length) {
    consSource = 'championship'
    constructors = cs.map((s: any, i: number) => ({
      id: s.Constructor.constructorId,
      name: s.Constructor.name,
      color: TEAM_COLORS[s.Constructor.constructorId] ?? '#888',
      champPos: s.position ? Number(s.position) : i + 1,
      points: Number(s.points ?? 0),
      wins: Number(s.wins ?? 0),
    }))
  } else {
    consSource = 'avg-finish'
    const agg = new Map<string, { sum: number; n: number }>()
    for (const r of seasonResults) {
      const cid = driverInfo.get(r.driver_id)?.constructorId
      if (!cid) continue
      const a = agg.get(cid) ?? { sum: 0, n: 0 }
      a.sum += r.finish_position; a.n += 1; agg.set(cid, a)
    }
    constructors = [...agg.entries()]
      .map(([id, a]) => ({ id, name: consName.get(id) ?? id, color: TEAM_COLORS[id] ?? '#888', champPos: 0, points: null, avgFinish: a.sum / a.n }))
      .sort((a, b) => a.avgFinish - b.avgFinish)
      .map((c, i) => ({ ...c, champPos: i + 1 }))
  }

  return NextResponse.json({ ok: true, driversSource, consSource, drivers, constructors })
}
