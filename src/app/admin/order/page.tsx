'use client'
import { Suspense, useEffect, useState, CSSProperties } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'
import { computePoolStandings, draftOrderFromStandings } from '@/lib/standings'
import { CURRENT_SEASON } from '@/lib/config'

const btn: CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
}
const shortName = (n: string) => n.replace(/\s+Grand Prix$/i, '')

function DraftOrderInner() {
  const { actingAs } = usePlayer()
  const round = Number(useSearchParams().get('round') ?? 0)
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [race, setRace] = useState<{ id: string; name: string } | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    (async () => {
      const { data: pls } = await supabase.from('players').select('id,name').order('sort_order')
      const players = pls ?? []
      setPlayers(players)
      const standings = await computePoolStandings(players.map(p => p.id))
      setOrder(draftOrderFromStandings(standings, players.map(p => p.id)))
      const { data: r } = await supabase
        .from('races').select('id,name').eq('season', CURRENT_SEASON).eq('round', round).maybeSingle()
      setRace(r ?? null)
    })()
  }, [round])

  if (!actingAs) return <NamePicker />
  if (!actingAs.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  const nameById = Object.fromEntries(players.map(p => [p.id, p.name]))
  const city = race ? shortName(race.name) : `Round ${round}`

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
    setMsg('Order set from standings (worst-placed picks first).')
  }

  async function openDraft() {
    if (!race) { setMsg('Pick a race on the Commissioner page first.'); return }
    const { error } = await supabase
      .from('drafts').upsert({ race_id: race.id, pick_order: order, status: 'open', rounds: 5 }, { onConflict: 'race_id' })
    if (error) { setMsg(`Open failed: ${error.message}`); return }
    await supabase.from('races').update({ status: 'drafting' }).eq('id', race.id)
    setMsg(`${city} draft opened. Players can pick on the Draft tab.`)
  }

  async function complete() {
    if (!race) return
    await supabase.from('races').update({ status: 'complete' }).eq('id', race.id)
    setMsg(`${city} completed & scored. Check Standings.`)
  }

  return (
    <main style={{ padding: 16 }}>
      <Link href="/admin" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>← Commissioner</Link>
      <h1 style={{ fontSize: 22, marginTop: 6 }}>Draft Order — {city}</h1>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
        Auto-set from the standings (worst-placed picks first). Override with ↑/↓.
      </p>
      <button onClick={autoOrder} style={btn}>↻ Auto-set from standings</button>

      <div style={{ marginTop: 10 }}>
        {order.map((id, i) => (
          <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6 }}>
            <span style={{ flex: 1 }}>{i + 1}. {nameById[id]}</span>
            <button onClick={() => move(i, -1)} style={{ ...btn, padding: '4px 10px' }}>↑</button>
            <button onClick={() => move(i, 1)} style={{ ...btn, padding: '4px 10px' }}>↓</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={openDraft} style={{ ...btn, flex: 1 }}>Open {city} Draft</button>
        <button onClick={complete} style={{ ...btn, flex: 1 }}>Complete {city}</button>
      </div>

      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}

export default function DraftOrderPage() {
  return <Suspense fallback={<main style={{ padding: 16 }}>Loading…</main>}><DraftOrderInner /></Suspense>
}
