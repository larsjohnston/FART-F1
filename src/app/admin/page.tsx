'use client'
import { useEffect, useState, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase/client'
import { undoLastPick } from '@/lib/draft/service'
import { usePlayer } from '@/lib/players/context'

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

  if (!actingAs?.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  async function sync() {
    setMsg('Syncing…')
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ season: Number(season), round: Number(round) }),
    }).then(r => r.json())
    setMsg(res.ok ? `Synced ${res.drivers} drivers (raced: ${res.raced})` : `Error: ${res.error}`)
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
