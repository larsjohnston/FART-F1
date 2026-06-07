'use client'
import { useCallback, useEffect, useState, CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'
import { rankDraftedPoints } from '@/lib/scoring/score'
import { CURRENT_SEASON } from '@/lib/config'

const PRIOR_ROUNDS = [1, 2, 3, 4, 5]

const inp: CSSProperties = {
  width: 64, background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: 4,
}
const btn: CSSProperties = {
  background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px',
}

export default function PriorRacesPage() {
  const { actingAs } = usePlayer()
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([])
  const [round, setRound] = useState(1)
  const [mode, setMode] = useState<'points' | 'picks'>('points')
  const [raceName, setRaceName] = useState('')
  const [pts, setPts] = useState<Record<string, string>>({})
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([])
  const [assign, setAssign] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('players').select('id,name').order('sort_order').then(({ data }) => setPlayers(data ?? []))
  }, [])

  const loadRound = useCallback(async (rnd: number) => {
    setMsg('')
    const { data: race } = await supabase
      .from('races').select('id,name').eq('season', CURRENT_SEASON).eq('round', rnd).maybeSingle()
    setRaceName(race?.name ?? `Round ${rnd}`)

    const { data: pp } = await supabase
      .from('prior_race_points').select('player_id,points').eq('season', CURRENT_SEASON).eq('round', rnd)
    setPts(Object.fromEntries((pp ?? []).map(r => [r.player_id, String(r.points)])))

    if (!race) { setDrivers([]); setAssign({}); return }
    // All drivers in this race = results ∪ qualifying (results carries the full
    // 22-car field even when some drivers set no qualifying time).
    const { data: res } = await supabase
      .from('results').select('driver_id,finish_position').eq('race_id', race.id)
    const { data: q } = await supabase
      .from('qualifying').select('driver_id,position').eq('race_id', race.id)
    const qpos = new Map((q ?? []).map(r => [r.driver_id, r.position]))
    const fpos = new Map((res ?? []).map(r => [r.driver_id, r.finish_position]))
    const ids = [...new Set([...(res ?? []).map(r => r.driver_id), ...(q ?? []).map(r => r.driver_id)])]
    // Order by grid where available, otherwise by finishing position (after the qualifiers).
    ids.sort((a, b) => (qpos.get(a) ?? (fpos.get(a) ?? 99) + 100) - (qpos.get(b) ?? (fpos.get(b) ?? 99) + 100))
    let drv: { id: string; given_name: string; family_name: string }[] = []
    if (ids.length) {
      const dres = await supabase.from('drivers').select('id,given_name,family_name').in('id', ids)
      drv = dres.data ?? []
    }
    const nameMap = new Map(drv.map(d => [d.id, `${d.given_name?.[0] ?? ''}. ${d.family_name}`]))
    setDrivers(ids.map(id => ({ id, name: nameMap.get(id) ?? id })))

    const { data: draft } = await supabase.from('drafts').select('id').eq('race_id', race.id).maybeSingle()
    if (draft) {
      const { data: picks } = await supabase.from('picks').select('player_id,driver_id').eq('draft_id', draft.id)
      setAssign(Object.fromEntries((picks ?? []).map(p => [p.driver_id, p.player_id])))
    } else {
      setAssign({})
    }
  }, [])

  useEffect(() => { loadRound(round) }, [round, loadRound])

  if (!actingAs) return <NamePicker />
  if (!actingAs.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  async function savePoints() {
    setMsg('Saving points…')
    const rows = players.map(p => ({
      season: CURRENT_SEASON, round, player_id: p.id, points: Math.round(Number(pts[p.id] ?? 0)) || 0,
    }))
    const { error } = await supabase.from('prior_race_points').upsert(rows, { onConflict: 'season,round,player_id' })
    setMsg(error ? `Error: ${error.message}` : `Saved Round ${round} points. Check Standings.`)
  }

  async function savePicks() {
    setMsg('Saving picks…')
    const { data: race } = await supabase
      .from('races').select('id').eq('season', CURRENT_SEASON).eq('round', round).maybeSingle()
    if (!race) { setMsg('That round isn’t synced yet.'); return }

    const order = players.map(p => p.id)
    const { data: draft, error: dErr } = await supabase
      .from('drafts')
      .upsert({ race_id: race.id, pick_order: order, status: 'locked', rounds: 5, historic: true }, { onConflict: 'race_id' })
      .select('id').single()
    if (dErr || !draft) { setMsg(`Draft save failed: ${dErr?.message}`); return }

    await supabase.from('picks').delete().eq('draft_id', draft.id)
    const entries = Object.entries(assign).filter(([, pid]) => pid)
    const rows = entries.map(([driverId, playerId], i) => ({
      draft_id: draft.id, overall: i + 1, round: Math.floor(i / Math.max(players.length, 1)) + 1,
      player_id: playerId, actor_id: playerId, driver_id: driverId,
    }))
    if (rows.length) {
      const { error: pErr } = await supabase.from('picks').insert(rows)
      if (pErr) { setMsg(`Picks insert failed: ${pErr.message}`); return }
    }

    // Compute the re-ranked points from results and store them as this race's prior points.
    const { data: results } = await supabase.from('results').select('driver_id,finish_position').eq('race_id', race.id)
    const finish = new Map((results ?? []).map(r => [r.driver_id, r.finish_position]))
    const ptsMap = rankDraftedPoints(entries.map(([d]) => d), finish)
    const byPlayer: Record<string, number> = {}
    for (const [driverId, playerId] of entries) byPlayer[playerId] = (byPlayer[playerId] ?? 0) + (ptsMap.get(driverId) ?? 0)
    const ppRows = players.map(p => ({ season: CURRENT_SEASON, round, player_id: p.id, points: byPlayer[p.id] ?? 0 }))
    await supabase.from('prior_race_points').upsert(ppRows, { onConflict: 'season,round,player_id' })

    setMsg(`Saved ${rows.length} picks for Round ${round}${finish.size ? ' and computed points' : ' (no results yet to score)'}.`)
    loadRound(round)
  }

  return (
    <main style={{ padding: 16 }}>
      <Link href="/admin" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>← Admin</Link>
      <h1 style={{ fontSize: 22, marginTop: 6 }}>Update Prior Races</h1>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
        Races before the app (1-5). These feed the season standings; in-app races are scored automatically.
      </p>

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        {PRIOR_ROUNDS.map(r => (
          <button key={r} onClick={() => setRound(r)} style={{ ...btn, flex: 1, background: round === r ? 'var(--accent)' : 'var(--panel-2)' }}>
            R{r}
          </button>
        ))}
      </div>
      <div style={{ fontWeight: 700, marginTop: 10 }}>{raceName}</div>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button onClick={() => setMode('points')} style={{ ...btn, flex: 1, background: mode === 'points' ? 'var(--panel)' : 'var(--panel-2)', borderColor: mode === 'points' ? 'var(--accent)' : 'var(--line)' }}>By points</button>
        <button onClick={() => setMode('picks')} style={{ ...btn, flex: 1, background: mode === 'picks' ? 'var(--panel)' : 'var(--panel-2)', borderColor: mode === 'picks' ? 'var(--accent)' : 'var(--line)' }}>By picks</button>
      </div>

      {mode === 'points' ? (
        <section>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>Each player&apos;s points for this race (lower is better).</p>
          {players.map(p => (
            <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6 }}>
              <span style={{ flex: 1 }}>{p.name}</span>
              <input value={pts[p.id] ?? ''} onChange={e => setPts({ ...pts, [p.id]: e.target.value })} style={inp} />
            </div>
          ))}
          <button onClick={savePoints} style={{ ...btn, marginTop: 8 }}>Save Round {round} points</button>
        </section>
      ) : (
        <section>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
            Assign each driver to a player. Points are computed from the race result (undrafted removed, rest ranked).
          </p>
          {drivers.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No drivers for this round yet — sync it in Admin first.</p>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0' }}>
                {players.map(p => `${p.name}: ${Object.values(assign).filter(v => v === p.id).length}`).join('  ·  ')}
              </div>
              {drivers.map(d => (
                <div key={d.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
                  {players.map(p => (
                    <button key={p.id}
                      onClick={() => setAssign(a => ({ ...a, [d.id]: a[d.id] === p.id ? '' : p.id }))}
                      style={{ ...btn, padding: '4px 8px', fontSize: 11, background: assign[d.id] === p.id ? 'var(--accent)' : 'var(--panel-2)' }}>
                      {p.name.slice(0, 3)}
                    </button>
                  ))}
                </div>
              ))}
              <button onClick={savePicks} style={{ ...btn, marginTop: 8 }}>Save Round {round} picks</button>
            </>
          )}
        </section>
      )}

      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}
