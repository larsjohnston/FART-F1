'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import { loadDraft, makePick, subscribePicks, undoLastPick, type DraftRow } from '@/lib/draft/service'
import { onClock } from '@/lib/draft/engine'
import type { DraftState } from '@/lib/draft/types'
import DriverCard, { type DriverVM } from '@/components/DriverCard'
import OnTheClock from '@/components/OnTheClock'
import { CURRENT_SEASON } from '@/lib/config'

export default function DraftPage() {
  const { actingAs } = usePlayer()
  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [state, setState] = useState<DraftState | null>(null)
  const [drivers, setDrivers] = useState<DriverVM[]>([])
  const [players, setPlayers] = useState<Record<string, { name: string }>>({})
  const [raceName, setRaceName] = useState('')

  const refresh = useCallback(async () => {
    // Active race = latest race currently 'drafting'.
    const { data: race } = await supabase
      .from('races')
      .select('id,name')
      .eq('status', 'drafting')
      .eq('season', CURRENT_SEASON)
      .order('round', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!race) {
      setDraft(null); setState(null); setDrivers([])
      return
    }
    setRaceName(race.name)

    const loaded = await loadDraft(race.id)
    if (!loaded) {
      setDraft(null); setState(null); setDrivers([])
      return
    }
    setDraft(loaded.draft)
    setState(loaded.state)

    const { data: pl } = await supabase.from('players').select('id,name')
    const playerMap = Object.fromEntries((pl ?? []).map(p => [p.id, { name: p.name }])) as Record<string, { name: string }>
    setPlayers(playerMap)

    // Load drivers + constructors as two queries (anon-friendly).
    const { data: drv } = await supabase
      .from('drivers')
      .select('id,given_name,family_name,headshot_url,constructor_id')
    const { data: cons } = await supabase.from('constructors').select('id,name,color')
    const consMap = new Map((cons ?? []).map(c => [c.id, { name: c.name, color: c.color }]))

    const { data: q } = await supabase
      .from('qualifying')
      .select('driver_id,position')
      .eq('race_id', race.id)
    const qmap = new Map((q ?? []).map(r => [r.driver_id, r.position]))

    const takenBy = new Map(
      loaded.state.picks.map(p => [p.driverId, playerMap[p.playerId]?.name ?? 'someone']),
    )

    setDrivers(
      (drv ?? [])
        // Only the drivers who qualified for THIS race are draftable (the 22 on
        // the 2026 grid), never the whole cross-season drivers table.
        .filter((d) => qmap.has(d.id))
        .map((d) => {
          const c = consMap.get(d.constructor_id) ?? { name: '', color: '#888' }
          return {
            id: d.id,
            name: `${d.given_name?.[0] ?? ''}. ${d.family_name}`,
            team: c.name,
            teamColor: c.color,
            headshot: d.headshot_url,
            quali: qmap.get(d.id),
            drafted: takenBy.has(d.id) ? { byName: takenBy.get(d.id)! } : null,
          } as DriverVM
        })
        .sort((a, b) => (a.quali ?? 99) - (b.quali ?? 99)),
    )
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!draft) return
    return subscribePicks(draft.id, refresh)
  }, [draft, refresh])

  if (!actingAs) return <main style={{ padding: 20 }}>Pick your name on the home screen first.</main>
  if (!state || !draft) return <main style={{ padding: 20 }}>No active draft. Commissioner can open one in Admin.</main>

  const slot = onClock(state)
  const onClockName = slot ? players[slot.playerId]?.name ?? null : null
  const yours = slot?.playerId === actingAs.id

  async function pick(driverId: string) {
    if (!draft || !state || !actingAs) return
    try {
      await makePick(draft, state, driverId, actingAs.id)
      await refresh()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      alert(msg)
      await refresh()
    }
  }

  async function undo() {
    if (!draft) return
    await undoLastPick(draft.id)
    await refresh()
  }

  const last = state.picks[state.picks.length - 1]
  const lastDriverName = last ? drivers.find(d => d.id === last.driverId)?.name ?? last.driverId : null
  const lastPlayerName = last ? players[last.playerId]?.name ?? '' : ''

  return (
    <main>
      <div style={{ background: 'linear-gradient(90deg,#E8002D,#a80020)', padding: '12px 14px' }}>
        <div style={{ fontSize: 11, letterSpacing: 1, opacity: 0.85 }}>LIVE DRAFT</div>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{raceName}</div>
      </div>
      <OnTheClock name={onClockName} yours={yours} />
      {actingAs.is_commissioner && last && (
        <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Last: {lastPlayerName} → {lastDriverName}</span>
          <button
            onClick={undo}
            style={{ marginLeft: 'auto', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}
          >
            ↩ Undo
          </button>
        </div>
      )}
      {slot && !yours && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--warn)' }}>
          It&apos;s {onClockName}&apos;s turn. You can still pick for them if they&apos;re away — it&apos;ll show as
          &quot;picked by {actingAs.name}&quot;.
        </div>
      )}
      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {drivers.map(d => (
          <DriverCard key={d.id} d={d} canPick={!!slot} onPick={() => pick(d.id)} />
        ))}
      </div>
    </main>
  )
}
