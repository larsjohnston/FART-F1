'use client'
import { Suspense, useEffect, useState, CSSProperties } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'
import { computeDraftOrder } from '@/lib/standings'
import { CURRENT_SEASON } from '@/lib/config'

type Settings = { drivers_per_week: number; draft_order_type: 'snake' | 'sequential'; draft_order_basis: 'overall' | 'weekly' }
const DEFAULT_SETTINGS: Settings = { drivers_per_week: 5, draft_order_type: 'sequential', draft_order_basis: 'overall' }

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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    (async () => {
      const { data: pls } = await supabase.from('players').select('id,name').order('sort_order')
      const players = pls ?? []
      setPlayers(players)
      const { data: s } = await supabase
        .from('league_settings').select('drivers_per_week,draft_order_type,draft_order_basis').eq('id', 1).maybeSingle()
      const cfg = { ...DEFAULT_SETTINGS, ...(s ?? {}) } as Settings
      setSettings(cfg)
      setOrder(await computeDraftOrder(players.map(p => p.id), cfg.draft_order_basis))
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
    setOrder(await computeDraftOrder(players.map(p => p.id), settings.draft_order_basis))
    setMsg(settings.draft_order_basis === 'weekly'
      ? 'Order set from last week (weekly loser picks first).'
      : 'Order set from standings (worst-placed picks first).')
  }

  async function openDraft() {
    if (!race) { setMsg('Pick a race on the Commissioner page first.'); return }
    const { error } = await supabase
      .from('drafts').upsert(
        { race_id: race.id, pick_order: order, status: 'open', rounds: settings.drivers_per_week, snake: settings.draft_order_type === 'snake' },
        { onConflict: 'race_id' },
      )
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
        Auto-set from {settings.draft_order_basis === 'weekly' ? 'last week (weekly loser first)' : 'the standings (worst-placed first)'};
        {' '}{settings.draft_order_type === 'snake' ? 'snake' : 'sequential'} order, {settings.drivers_per_week} drivers each. Override with ↑/↓. Change rules in League Settings.
      </p>
      <button onClick={autoOrder} style={btn}>↻ Auto-set order</button>

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
