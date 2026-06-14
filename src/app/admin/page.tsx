'use client'
import { useEffect, useState, CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'

const inp: CSSProperties = {
  background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '6px 8px',
}
const btn: CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13,
  textDecoration: 'none', display: 'inline-block', textAlign: 'center', cursor: 'pointer',
}

const shortName = (n: string) => n.replace(/\s+Grand Prix$/i, '')

export default function AdminPage() {
  const { actingAs } = usePlayer()
  const [season, setSeason] = useState('2026')
  const [races, setRaces] = useState<{ round: number; name: string }[]>([])
  const [round, setRound] = useState('6')
  const [draftTiming, setDraftTiming] = useState<'before' | 'after'>('after')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('league_settings').select('draft_timing').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data?.draft_timing) setDraftTiming(data.draft_timing as 'before' | 'after') })
  }, [])

  useEffect(() => {
    supabase.from('races').select('round,name').eq('season', Number(season)).order('round')
      .then(({ data }) => {
        const rs = data ?? []
        setRaces(rs)
        if (rs.length && !rs.some(r => String(r.round) === round)) setRound(String(rs[rs.length - 1].round))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season])

  if (!actingAs) return <NamePicker />
  if (!actingAs.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  async function sync() {
    setMsg('Syncing…')
    const res = await fetch('/api/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ season: Number(season), round: Number(round) }),
    }).then(r => r.json())
    setMsg(
      !res.ok ? `Error: ${res.error}`
        : res.provisional ? `Provisional results synced — official will replace them within the hour.`
        : res.raced ? `Results synced — ${res.drivers} drivers.`
        : res.qualified ? `Qualifying synced — ${res.drivers} drivers.`
        : 'On the calendar but not qualified yet — sync again after Saturday qualifying.',
    )
  }

  async function setTiming(timing: 'before' | 'after') {
    setDraftTiming(timing)
    const { error } = await supabase.from('league_settings').update({ draft_timing: timing }).eq('id', 1)
    setMsg(error ? `Error: ${error.message}` : `Draft timing: ${timing === 'before' ? 'Pre-Qualifying' : 'Post Qualifying'}.`)
  }

  const toggle = (active: boolean): CSSProperties => ({
    ...btn, flex: 1,
    ...(active ? {} : { background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)' }),
  })

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Commissioner</h1>

      <section style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13 }}>Season <input value={season} onChange={e => setSeason(e.target.value)} style={{ ...inp, width: 64 }} /></label>
        <label style={{ fontSize: 13 }}>Race{' '}
          <select value={round} onChange={e => setRound(e.target.value)} style={inp}>
            {races.map(r => <option key={r.round} value={r.round}>{shortName(r.name)}</option>)}
          </select>
        </label>
        <button onClick={sync} style={btn}>Sync</button>
      </section>

      <section style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Draft Timing</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTiming('before')} style={toggle(draftTiming === 'before')}>Pre-Qualifying</button>
          <button onClick={() => setTiming('after')} style={toggle(draftTiming === 'after')}>Post Qualifying</button>
        </div>
      </section>

      <section style={{ marginTop: 20, display: 'grid', gap: 10 }}>
        <Link href={`/admin/order?round=${round}`} style={btn}>Draft Order →</Link>
        <Link href="/admin/prior" style={btn}>Update Prior Races →</Link>
      </section>

      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}
