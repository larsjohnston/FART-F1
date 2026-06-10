/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'

/** Aggregates the imported multi-season archive (2022-2026) for the History page:
 *  per-season standings + race-by-race points, and all-time career totals,
 *  titles, and each player's most-drafted driver. */
export async function GET() {
  const db = serverClient()
  const [{ data: players }, { data: rp }, { data: picks }] = await Promise.all([
    db.from('players').select('id,name,color').order('sort_order'),
    db.from('archive_race_points').select('season,race_no,player_id,points'),
    db.from('archive_picks').select('player_id,driver'),
  ])
  const pl = players ?? []
  const seasons = [...new Set((rp ?? []).map(r => r.season))].sort((a, b) => a - b)
  const latest = seasons.length ? Math.max(...seasons) : 0

  const bySeason: Record<number, { standings: any[]; races: any[]; complete: boolean }> = {}
  for (const s of seasons) {
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
    bySeason[s] = { standings, races, complete: s !== latest }
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
