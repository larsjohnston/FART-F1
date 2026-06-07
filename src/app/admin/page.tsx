'use client'
import { useEffect, useState, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase/client'
import { undoLastPick } from '@/lib/draft/service'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'

const inp: CSSProperties = {
  width: 64,
  background: 'var(--panel-2)',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: 4,
}
const btn: CSSProperties = {
  background: 'var(--panel-2)',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '6px 10px',
}

export default function AdminPage() {
  const { actingAs } = usePlayer()
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([])
  const [season, setSeason] = useState('2026')
  const [round, setRound] = useState('6')
  const [order, setOrder] = useState<string[]>([])
  const [carryIn, setCarryIn] = useState<Record<string, string>>({})
  const [histRound, setHistRound] = useState('1')
  const [histDrivers, setHistDrivers] = useState<{ id: string; name: string }[]>([])
  const [histAssign, setHistAssign] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase
      .from('players')
      .select('id,name,carry_in_points')
      .order('sort_order')
      .then(({ data }) => {
        setPlayers(data ?? [])
        setOrder((data ?? []).map(p => p.id))
        setCarryIn(Object.fromEntries((data ?? []).map(p => [p.id, String(p.carry_in_points ?? 0)])))
      })
  }, [])

  if (!actingAs) return <NamePicker />
  if (!actingAs.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  async function sync() {
    setMsg('Syncing…')
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ season: Number(season), round: Number(round) }),
    }).then(r => r.json())
    setMsg(
      !res.ok ? `Error: ${res.error}`
        : res.raced ? `Results synced — ${res.drivers} drivers. You can Close & score.`
        : res.qualified ? `Qualifying synced — ${res.drivers} drivers. Ready to open the draft.`
        : 'Round is on the calendar but hasn’t qualified yet — sync again after Saturday qualifying.',
    )
  }

  async function openDraft() {
    const { data: race } = await supabase
      .from('races')
      .select('id')
      .eq('season', Number(season))
      .eq('round', Number(round))
      .maybeSingle()
    if (!race) { setMsg('Sync the round first.'); return }
    const { error: dErr } = await supabase
      .from('drafts')
      .upsert({ race_id: race.id, pick_order: order, status: 'open', rounds: 5 }, { onConflict: 'race_id' })
    if (dErr) { setMsg(`Draft upsert failed: ${dErr.message}`); return }
    await supabase.from('races').update({ status: 'drafting' }).eq('id', race.id)
    setMsg('Draft opened. Players can pick on the Draft tab.')
  }

  async function closeAndScore() {
    const { data: race } = await supabase
      .from('races')
      .select('id')
      .eq('season', Number(season))
      .eq('round', Number(round))
      .maybeSingle()
    if (!race) { setMsg('Round not synced.'); return }
    await supabase.from('races').update({ status: 'complete' }).eq('id', race.id)
    setMsg('Race closed & scored. Check Standings.')
  }

  async function undo() {
    const { data: race } = await supabase
      .from('races')
      .select('id')
      .eq('season', Number(season))
      .eq('round', Number(round))
      .maybeSingle()
    if (!race) { setMsg('Round not synced.'); return }
    const { data: draft } = await supabase
      .from('drafts')
      .select('id')
      .eq('race_id', race.id)
      .maybeSingle()
    if (!draft) { setMsg('No draft for that round.'); return }
    await undoLastPick(draft.id)
    setMsg('Undid last pick.')
  }

  async function saveCarryIn() {
    setMsg('Saving carry-in points…')
    for (const p of players) {
      const n = Number(carryIn[p.id] ?? 0)
      const { error } = await supabase
        .from('players')
        .update({ carry_in_points: Number.isFinite(n) ? Math.round(n) : 0 })
        .eq('id', p.id)
      if (error) {
        setMsg(`Save failed: ${error.message}`)
        return
      }
    }
    setMsg('Carry-in points saved. Check Standings.')
  }

  async function loadHistRound() {
    setMsg('Loading round…')
    const { data: race } = await supabase
      .from('races').select('id').eq('season', Number(season)).eq('round', Number(histRound)).maybeSingle()
    if (!race) { setMsg('That round isn’t synced yet — Sync it first.'); setHistDrivers([]); return }
    const { data: q } = await supabase
      .from('qualifying').select('driver_id,position').eq('race_id', race.id).order('position')
    const ids = (q ?? []).map(r => r.driver_id)
    const { data: drv } = await supabase.from('drivers').select('id,given_name,family_name').in('id', ids)
    const nameMap = new Map((drv ?? []).map(d => [d.id, `${d.given_name?.[0] ?? ''}. ${d.family_name}`]))
    setHistDrivers(ids.map(id => ({ id, name: nameMap.get(id) ?? id })))
    const { data: draft } = await supabase.from('drafts').select('id').eq('race_id', race.id).maybeSingle()
    if (draft) {
      const { data: picks } = await supabase.from('picks').select('player_id,driver_id').eq('draft_id', draft.id)
      setHistAssign(Object.fromEntries((picks ?? []).map(p => [p.driver_id, p.player_id])))
    } else {
      setHistAssign({})
    }
    setMsg(`Loaded ${ids.length} drivers for round ${histRound}.`)
  }

  async function saveHistRound() {
    setMsg('Saving historic picks…')
    const { data: race } = await supabase
      .from('races').select('id').eq('season', Number(season)).eq('round', Number(histRound)).maybeSingle()
    if (!race) { setMsg('Round not synced.'); return }
    const { data: draft, error: dErr } = await supabase
      .from('drafts')
      .upsert({ race_id: race.id, pick_order: order, status: 'locked', rounds: 5, historic: true }, { onConflict: 'race_id' })
      .select('id').single()
    if (dErr || !draft) { setMsg(`Draft save failed: ${dErr?.message}`); return }
    await supabase.from('picks').delete().eq('draft_id', draft.id)
    const entries = Object.entries(histAssign).filter(([, pid]) => pid)
    const rows = entries.map(([driverId, playerId], i) => ({
      draft_id: draft.id, overall: i + 1, round: Math.floor(i / Math.max(players.length, 1)) + 1,
      player_id: playerId, actor_id: playerId, driver_id: driverId,
    }))
    if (rows.length) {
      const { error: pErr } = await supabase.from('picks').insert(rows)
      if (pErr) { setMsg(`Picks insert failed: ${pErr.message}`); return }
    }
    setMsg(`Saved ${rows.length} historic picks for round ${histRound}.`)
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
  }

  const nameById = Object.fromEntries(players.map(p => [p.id, p.name]))

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Commissioner</h1>

      <section style={{ marginTop: 12 }}>
        <label>
          Season <input value={season} onChange={e => setSeason(e.target.value)} style={inp} />
        </label>{' '}
        <label>
          Round <input value={round} onChange={e => setRound(e.target.value)} style={inp} />
        </label>
        <div style={{ marginTop: 8 }}>
          <button onClick={sync} style={btn}>Sync F1 data</button>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Carry-in points (imported totals after race 5)</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
          Each player&apos;s running total before the pool moved into the app. Added on top of races drafted here.
        </p>
        {players.map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6 }}>
            <span style={{ flex: 1 }}>{p.name}</span>
            <input
              value={carryIn[p.id] ?? ''}
              onChange={e => setCarryIn({ ...carryIn, [p.id]: e.target.value })}
              style={inp}
            />
          </div>
        ))}
        <button onClick={saveCarryIn} style={{ ...btn, marginTop: 8 }}>Save carry-in points</button>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Backfill historic picks (past races)</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
          For races run before the app (1-5). Feeds the Stats page; excluded from standings since carry-in covers them.
        </p>
        <label>Round <input value={histRound} onChange={e => setHistRound(e.target.value)} style={inp} /></label>{' '}
        <button onClick={loadHistRound} style={btn}>Load round</button>
        {histDrivers.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0' }}>
              {players.map(p => `${p.name}: ${Object.values(histAssign).filter(v => v === p.id).length}`).join('  ·  ')}
            </div>
            {histDrivers.map(d => (
              <div key={d.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
                {players.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setHistAssign(a => ({ ...a, [d.id]: a[d.id] === p.id ? '' : p.id }))}
                    style={{ ...btn, padding: '4px 8px', fontSize: 11, background: histAssign[d.id] === p.id ? 'var(--accent)' : 'var(--panel-2)' }}
                  >
                    {p.name.slice(0, 3)}
                  </button>
                ))}
              </div>
            ))}
            <button onClick={saveHistRound} style={{ ...btn, marginTop: 8 }}>Save historic picks</button>
          </>
        )}
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Draft order (worst-placed first; you set race 1 manually)</h3>
        {order.map((id, i) => (
          <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6 }}>
            <span style={{ flex: 1 }}>{i + 1}. {nameById[id]}</span>
            <button onClick={() => move(i, -1)} style={btn}>↑</button>
            <button onClick={() => move(i, 1)} style={btn}>↓</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={openDraft} style={btn}>Open draft for this round</button>
          <button onClick={closeAndScore} style={btn}>Close draft &amp; score</button>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <button onClick={undo} style={btn}>Undo last pick</button>
      </section>

      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}
