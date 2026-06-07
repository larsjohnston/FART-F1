/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { CURRENT_SEASON } from '@/lib/config'

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

/** Current drivers ranked by the F1 drivers' championship — used to populate the
 *  draft board for a "before qualifying" draft. Jolpica is the source of truth;
 *  if it's down we fall back to ranking by season average finish from our DB. */
export async function GET(req: NextRequest) {
  const season = Number(req.nextUrl.searchParams.get('season') ?? CURRENT_SEASON)
  const db = serverClient()

  // Try the official championship standings first.
  try {
    const j = await getJSON(`${JOLPICA}/${season}/driverStandings.json`)
    const standings = j?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
    if (standings.length) {
      const drivers = standings.map((s: any, i: number) => ({
        id: s.Driver.driverId,
        name: `${s.Driver.givenName?.[0] ?? ''}. ${s.Driver.familyName}`,
        team: s.Constructors?.[s.Constructors.length - 1]?.name ?? '',
        constructorId: s.Constructors?.[s.Constructors.length - 1]?.constructorId ?? '',
        champPos: s.position ? Number(s.position) : i + 1,
        points: Number(s.points ?? 0),
      }))
      return NextResponse.json({ ok: true, source: 'championship', drivers })
    }
  } catch { /* fall through to DB */ }

  // Fallback: rank current-season drivers by average finish from our own data.
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
  const agg = new Map<string, { sum: number; n: number }>()
  for (const r of results ?? []) {
    if (!seasonRaceIds.has(r.race_id)) continue
    const a = agg.get(r.driver_id) ?? { sum: 0, n: 0 }
    a.sum += r.finish_position; a.n += 1; agg.set(r.driver_id, a)
  }
  const drivers = [...agg.entries()]
    .map(([id, a]) => ({
      id,
      name: driverInfo.get(id)?.name ?? id,
      team: consName.get(driverInfo.get(id)?.constructorId ?? '') ?? '',
      constructorId: driverInfo.get(id)?.constructorId ?? '',
      champPos: 0,
      avgFinish: a.sum / a.n,
    }))
    .sort((a, b) => a.avgFinish - b.avgFinish)
    .map((d, i) => ({ ...d, champPos: i + 1 }))
  return NextResponse.json({ ok: true, source: 'avg-finish', drivers })
}
