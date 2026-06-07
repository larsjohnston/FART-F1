'use client'
import { useEffect, useState, CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { undoLastPick } from '@/lib/draft/service'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'
import { computePoolStandings, draftOrderFromStandings } from '@/lib/standings'

const inp: CSSProperties = {
  width: 64, background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: 4,
}
const btn: CSSProperties = {
  background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px',
}

export default function AdminPage() {
  const { actingAs } = usePlayer()
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([])
  const [season, setSeason] = useState('2026')
  const [round, setRound] = useState('6')
  const [order, setOrder] = useState<string[]>([])
  const [draftTiming, setDraftTiming] = useState<'before' | 'after'>('after')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('players').select('id,name').order('sort_order')
      const pls = data ?? []
      setPlayers(pls)
      const standings = await computePoolStandings(pls.map(p => p.id))
      setOrder(draftOrderFromStandings(standings, pls.map(p => p.id)))
    })()
    supabase.from('league_settings').select('draft_timing').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data?.draft_timing) setDraftTiming(data.draft_timing as 'before' | 'after') })
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

  async function setTiming(timing: 'before' | 'after') {
    setDraftTiming(timing)
    const { error } = await supabase.from('league_settings').update({ draft_timing: timing }).eq('id', 1)
    setMsg(error ? `Error: ${error.message}`
      : `Draft timing: ${timing === 'before' ? 'BEFORE qualifying (championship order)' : 'AFTER qualifying (grid order)'}.`)
  }

  async function openDraft() {
    const { data: race } = await supabase
      .from('races').select('id').eq('season', Number(season)).eq('round', Number(round)).maybeSingle()
    if (!race) { setMsg('Sync the round first.'); return }
    const { error: dErr } = await supabase
      .from('drafts')
      .upsert({ race_id: race.id, pick_order: order, status: 'open', rounds: 5 }, { onConflict: 'race_id' })
    if (dErr) { setMsg(`Draft upsert failed: ${dErr.message}`); return }
    await supabase.from('races').update({ status: 'drafting' }).eq('id', race.id)
    setMsg(`Draft opened for round ${round}. Players can pick on the Draft tab.`)
  }

  async function closeAndScore() {
    const { data: race } = await supabase
      .from('races').select('id').eq('season', Number(season)).eq('round', Number(round)).maybeSingle()
    if (!race) { setMsg('Round not synced.'); return }
    await supabase.from('races').update({ status: 'complete' }).eq('id', race.id)
    setMsg('Race closed & scored. Check Standings.')
  }

  async function undo() {
    const { data: race } = await supabase
      .from('races').select('id').eq('season', Number(season)).eq('round', Number(round)).maybeSingle()
    if (!race) { setMsg('Round not synced.'); return }
    const { data: draft } = await supabase.from('drafts').select('id').eq('race_id', race.id).maybeSingle()
    if (!draft) { setMsg('No draft for that round.'); return }
    await undoLastPick(draft.id)
    setMsg('Undid last pick.')
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
  }

  async function autoOrder() {
    const standings = await computePoolStandings(players.map(p => p.id))
    setOrder(draftOrderFromStandings(standings, players.map(p => p.id)))
    setMsg('Draft order set from standings (worst-placed picks first).')
  }

  const nameById = Object.fromEntries(players.map(p => [p.id, p.name]))

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Commissioner</h1>

      <section style={{ marginTop: 12 }}>
        <label>Season <input value={season} onChange={e => setSeason(e.target.value)} style={inp} /></label>{' '}
        <label>Round <input value={round} onChange={e => setRound(e.target.value)} style={inp} /></label>
        <div style={{ marginTop: 8 }}>
          <button onClick={sync} style={btn}>Sync F1 data</button>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Draft timing (league default)</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
          Before quali: board shows all drivers by championship standings (draftable as soon as the prior race is closed).
          After quali: board shows the qualifying grid.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTiming('before')} style={{ ...btn, background: draftTiming === 'before' ? 'var(--accent)' : 'var(--panel-2)' }}>Before qualifying</button>
          <button onClick={() => setTiming('after')} style={{ ...btn, background: draftTiming === 'after' ? 'var(--accent)' : 'var(--panel-2)' }}>After qualifying</button>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Draft order</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
          Auto-set from the standings (worst-placed picks first). Override with ↑/↓.
        </p>
        <button onClick={autoOrder} style={{ ...btn, marginBottom: 8 }}>↻ Auto-set from standings</button>
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

      <section style={{ marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        <Link href="/admin/prior" style={{ ...btn, display: 'inline-block', textDecoration: 'none', background: 'var(--panel)' }}>
          Update Prior Races →
        </Link>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
          Enter points or picks for races 1-5 (before the app), one race at a time.
        </p>
      </section>

      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}
