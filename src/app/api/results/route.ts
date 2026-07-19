/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { CURRENT_SEASON } from '@/lib/config'
import { TEAM_COLORS } from '@/lib/f1/teamColors'

/** Actual F1 race results for the season, grouped by round (newest first) with
 *  the full classification per race — pure race data, nothing about the pool's
 *  drafts or players. Powers the Draft page's "Results" tab. Only races that
 *  have results stored are returned; `provisional` flags a race still on the
 *  preliminary feed (DNFs may be missing until the official sync). */
export async function GET(req: NextRequest) {
  const season = Number(req.nextUrl.searchParams.get('season') ?? CURRENT_SEASON)
  const db = serverClient()

  const { data: races } = await db
    .from('races').select('id,round,name,date,status').eq('season', season)
  const raceIds = (races ?? []).map((r: any) => r.id)
  if (!raceIds.length) return NextResponse.json({ ok: true, season, races: [] })

  const [{ data: results }, { data: drv }, { data: cons }] = await Promise.all([
    db.from('results').select('race_id,driver_id,finish_position,grid,status,provisional').in('race_id', raceIds),
    db.from('drivers').select('id,given_name,family_name,constructor_id'),
    db.from('constructors').select('id,name,color'),
  ])
  const consInfo = new Map((cons ?? []).map((c: any) => [c.id, { name: c.name, color: c.color }]))
  const driverInfo = new Map((drv ?? []).map((d: any) => [d.id, {
    name: `${d.given_name?.[0] ?? ''}. ${d.family_name}`, constructorId: d.constructor_id,
  }]))

  const byRace = new Map<string, any[]>()
  for (const r of results ?? []) {
    const list = byRace.get(r.race_id) ?? []
    const di = driverInfo.get(r.driver_id)
    const ci = di ? consInfo.get(di.constructorId) : undefined
    list.push({
      pos: r.finish_position,
      driverId: r.driver_id,
      driver: di?.name ?? r.driver_id,
      team: ci?.name ?? '',
      teamColor: ci?.color ?? TEAM_COLORS[di?.constructorId ?? ''] ?? '#888',
      grid: r.grid ?? null,
      status: r.status ?? '',
      provisional: !!r.provisional,
    })
    byRace.set(r.race_id, list)
  }

  const out = (races ?? [])
    .filter((r: any) => byRace.has(r.id))
    .map((r: any) => {
      const rows = (byRace.get(r.id) ?? []).sort((a, b) => a.pos - b.pos)
      return {
        id: r.id, round: r.round, name: r.name, date: r.date, status: r.status,
        provisional: rows.some(x => x.provisional),
        results: rows,
      }
    })
    .sort((a: any, b: any) => b.round - a.round)

  return NextResponse.json({ ok: true, season, races: out })
}
