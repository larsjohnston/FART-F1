'use client'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase/client'
import { scoreRace, addToCumulative } from '@/lib/scoring/score'
import { CURRENT_SEASON } from '@/lib/config'

interface SeasonRow { name: string; color: string; points: number }
interface WeekDriver { name: string; teamColor: string; pos: number }
interface WeekRow { name: string; color: string; points: number; drivers: WeekDriver[] }
interface Week { raceName: string; hasResults: boolean; rows: WeekRow[] }

export default function StandingsPage() {
  const [view, setView] = useState<'season' | 'week'>('season')
  const [seasonRows, setSeasonRows] = useState<SeasonRow[]>([])
  const [week, setWeek] = useState<Week | null>(null)

  const load = useCallback(async () => {
    const { data: players } = await supabase.from('players').select('id,name,color,carry_in_points')
    const pl = (players ?? []) as { id: string; name: string; color: string; carry_in_points?: number }[]
    const nameById: Record<string, string> = Object.fromEntries(pl.map(p => [p.id, p.name]))
    const colorById: Record<string, string> = Object.fromEntries(pl.map(p => [p.id, p.color]))

    // ---------- Season (cumulative championship) ----------
    const { data: completeRaces } = await supabase
      .from('races').select('id').eq('status', 'complete').eq('season', CURRENT_SEASON)
    let cumulative: Record<string, number> = {}
    for (const p of pl) cumulative[p.id] = p.carry_in_points ?? 0
    for (const r of completeRaces ?? []) {
      const { data: draft } = await supabase.from('drafts').select('id,historic').eq('race_id', r.id).maybeSingle()
      // Skip backfilled historic races — they're already in carry_in_points.
      if (!draft || draft.historic) continue
      const { data: picks } = await supabase.from('picks').select('player_id,driver_id').eq('draft_id', draft.id)
      const { data: results } = await supabase.from('results').select('driver_id,finish_position').eq('race_id', r.id)
      const byPlayer: Record<string, string[]> = {}
      for (const p of picks ?? []) (byPlayer[p.player_id] ??= []).push(p.driver_id)
      cumulative = addToCumulative(
        cumulative,
        scoreRace(byPlayer, (results ?? []).map(x => ({ driverId: x.driver_id, finishPosition: x.finish_position }))),
      )
    }
    setSeasonRows(
      Object.entries(cumulative)
        .map(([id, points]) => ({ name: nameById[id] ?? id, color: colorById[id] ?? '#888', points }))
        .sort((a, b) => a.points - b.points),
    )

    // ---------- This week (the current race) ----------
    const { data: drafts } = await supabase.from('drafts').select('id,race_id')
    const { data: seasonRaces } = await supabase
      .from('races').select('id,round,name').eq('season', CURRENT_SEASON).order('round', { ascending: false })
    const draftByRace = new Map((drafts ?? []).map(d => [d.race_id, d.id as string]))
    const race = (seasonRaces ?? []).find(r => draftByRace.has(r.id))
    if (!race) { setWeek(null); return }
    const draftId = draftByRace.get(race.id) as string

    const { data: picks } = await supabase.from('picks').select('player_id,driver_id').eq('draft_id', draftId)
    const { data: results } = await supabase.from('results').select('driver_id,finish_position').eq('race_id', race.id)
    const { data: quali } = await supabase.from('qualifying').select('driver_id,position').eq('race_id', race.id)
    const { data: drv } = await supabase.from('drivers').select('id,given_name,family_name,constructor_id')
    const { data: cons } = await supabase.from('constructors').select('id,color')

    const consColor = new Map((cons ?? []).map(c => [c.id, c.color as string]))
    const driverInfo = new Map(
      (drv ?? []).map(d => [d.id, {
        name: `${d.given_name?.[0] ?? ''}. ${d.family_name}`,
        teamColor: consColor.get(d.constructor_id) ?? '#888',
      }]),
    )

    // Results once the race is scored; otherwise project from the qualifying grid.
    const hasResults = (results ?? []).length > 0
    const posByDriver = new Map<string, number>()
    if (hasResults) for (const r of results ?? []) posByDriver.set(r.driver_id, r.finish_position)
    else for (const q of quali ?? []) posByDriver.set(q.driver_id, q.position)

    const byPlayer: Record<string, WeekDriver[]> = {}
    for (const p of picks ?? []) {
      const info = driverInfo.get(p.driver_id)
      ;(byPlayer[p.player_id] ??= []).push({
        name: info?.name ?? p.driver_id,
        teamColor: info?.teamColor ?? '#888',
        pos: posByDriver.get(p.driver_id) ?? 0,
      })
    }
    const wrows: WeekRow[] = Object.entries(byPlayer)
      .map(([pid, drivers]) => ({
        name: nameById[pid] ?? pid,
        color: colorById[pid] ?? '#888',
        points: drivers.reduce((s, d) => s + d.pos, 0),
        drivers: drivers.sort((a, b) => a.pos - b.pos),
      }))
      .sort((a, b) => a.points - b.points)
    setWeek({ raceName: race.name, hasResults, rows: wrows })
  }, [])

  useEffect(() => { load() }, [load])

  // Live: recompute whenever results or picks change anywhere.
  useEffect(() => {
    const ch = supabase
      .channel('standings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'results' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const tab = (active: boolean): CSSProperties => ({
    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, border: '1px solid var(--line)',
    background: active ? 'var(--accent)' : 'var(--panel-2)', color: '#fff', fontWeight: 700,
  })

  return (
    <main style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => setView('season')} style={tab(view === 'season')}>Championship</button>
        <button onClick={() => setView('week')} style={tab(view === 'week')}>This Week</button>
      </div>

      {view === 'season' ? (
        <>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Lowest total wins (golf scoring).</p>
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            {seasonRows.map((r, i) => (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: 'var(--panel-2)', border: '1px solid var(--line)', borderLeft: `4px solid ${r.color}`, borderRadius: 10 }}>
                <span style={{ width: 24, color: i === 0 ? 'var(--warn)' : 'var(--muted)' }}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 700 }}>{r.name}</span>
                <span>{r.points}</span>
              </div>
            ))}
            {seasonRows.length === 0 && <p style={{ color: 'var(--muted)' }}>No completed races scored yet.</p>}
          </div>
        </>
      ) : !week ? (
        <p style={{ color: 'var(--muted)' }}>No race drafted yet this season.</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>{week.raceName}</h2>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: week.hasResults ? '#10331e' : '#3a2f10', color: week.hasResults ? 'var(--live)' : 'var(--warn)' }}>
              {week.hasResults ? '● RESULTS IN' : '◌ PROJECTED'}
            </span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
            {week.hasResults
              ? 'Final points for this race. Updates live as results sync.'
              : 'Projected from the qualifying grid until results are in. Updates live.'}
          </p>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {week.rows.map((r, i) => (
              <div key={r.name} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: 'var(--panel)', borderLeft: `4px solid ${r.color}` }}>
                  <span style={{ width: 24, color: i === 0 ? 'var(--warn)' : 'var(--muted)' }}>{i + 1}</span>
                  <span style={{ flex: 1, fontWeight: 700 }}>{r.name}</span>
                  <span style={{ fontWeight: 800 }}>{r.points}</span>
                </div>
                {r.drivers.map((d, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: '1px solid var(--line)', fontSize: 13 }}>
                    <span style={{ width: 4, height: 16, borderRadius: 2, background: d.teamColor }} />
                    <span style={{ flex: 1 }}>{d.name}</span>
                    <span style={{ color: 'var(--muted)' }}>P{d.pos} · {d.pos} pt{d.pos === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            ))}
            {week.rows.length === 0 && <p style={{ color: 'var(--muted)' }}>No picks yet for this race.</p>}
          </div>
        </>
      )}
    </main>
  )
}
