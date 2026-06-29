'use client'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import { loadDraft, makePick, subscribePicks, undoLastPick, loadCommentary, subscribeCommentary, type DraftRow, type CommentaryRow } from '@/lib/draft/service'
import { onClock } from '@/lib/draft/engine'
import type { DraftState } from '@/lib/draft/types'
import DriverCard, { type DriverVM } from '@/components/DriverCard'
import OnTheClock from '@/components/OnTheClock'
import PlayerAvatar from '@/components/PlayerAvatar'
import NamePicker from '@/components/NamePicker'
import EnableNotifications from '@/components/EnableNotifications'
import { CURRENT_SEASON } from '@/lib/config'
import { TEAM_COLORS } from '@/lib/f1/teamColors'

interface ChampDriver { id: string; name: string; team: string; constructorId: string; champPos: number; points: number | null }
interface ChampCons { id: string; name: string; color: string; champPos: number; points: number | null }

export default function DraftPage() {
  const { actingAs } = usePlayer()
  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [state, setState] = useState<DraftState | null>(null)
  const [drivers, setDrivers] = useState<DriverVM[]>([])
  const [players, setPlayers] = useState<Record<string, { name: string; color: string; photoUrl: string | null }>>({})
  const [raceName, setRaceName] = useState('')
  const [view, setView] = useState<'players' | 'sequence'>('players')
  const [champ, setChamp] = useState<{ drivers: ChampDriver[]; constructors: ChampCons[] } | null>(null)
  const [champView, setChampView] = useState<'drivers' | 'constructors'>('drivers')
  const [commentary, setCommentary] = useState<CommentaryRow[]>([])

  const loadComms = useCallback(async (draftId: string) => {
    setCommentary(await loadCommentary(draftId))
  }, [])

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
      setDraft(null); setState(null); setDrivers([]); setCommentary([])
      return
    }
    setRaceName(race.name)

    const loaded = await loadDraft(race.id)
    if (!loaded) {
      setDraft(null); setState(null); setDrivers([]); setCommentary([])
      return
    }
    setDraft(loaded.draft)
    loadComms(loaded.draft.id)
    setState(loaded.state)

    const { data: pl } = await supabase.from('players').select('id,name,color,photo_url')
    const playerMap = Object.fromEntries((pl ?? []).map(p => [p.id, { name: p.name, color: p.color, photoUrl: p.photo_url ?? null }])) as Record<string, { name: string; color: string; photoUrl: string | null }>
    setPlayers(playerMap)

    // Load drivers + constructors as two queries (anon-friendly).
    const { data: drv } = await supabase
      .from('drivers')
      .select('id,given_name,family_name,headshot_url,constructor_id')
    const { data: cons } = await supabase.from('constructors').select('id,name,color')
    const consMap = new Map((cons ?? []).map(c => [c.id, { name: c.name, color: c.color }]))
    const headshotById = new Map((drv ?? []).map(d => [d.id, d.headshot_url]))
    const dbNameById = new Map((drv ?? []).map(d => [d.id, `${d.given_name?.[0] ?? ''}. ${d.family_name}`]))

    const takenBy = new Map(
      loaded.state.picks.map(p => [p.driverId, playerMap[p.playerId]?.name ?? 'someone']),
    )

    // League setting: draft before or after qualifying.
    const { data: settings } = await supabase
      .from('league_settings').select('draft_timing').eq('id', 1).maybeSingle()

    if (settings?.draft_timing === 'before') {
      // Board = all current drivers ranked by the F1 drivers' championship.
      const champ = await fetch(`/api/championship?season=${CURRENT_SEASON}`).then(r => r.json()).catch(() => null)
      const list: { id: string; name: string; team: string; constructorId: string }[] = champ?.drivers ?? []
      setDrivers(
        list.map((d) => {
          const c = consMap.get(d.constructorId)
          return {
            id: d.id,
            name: dbNameById.get(d.id) ?? d.name,
            team: c?.name ?? d.team,
            teamColor: c?.color ?? '#888',
            headshot: headshotById.get(d.id) ?? null,
            quali: undefined,
            drafted: takenBy.has(d.id) ? { byName: takenBy.get(d.id)! } : null,
          } as DriverVM
        }),
      )
      return
    }

    // After qualifying: only the drivers who qualified for THIS race, by grid.
    const { data: q } = await supabase
      .from('qualifying')
      .select('driver_id,position')
      .eq('race_id', race.id)
    const qmap = new Map((q ?? []).map(r => [r.driver_id, r.position]))

    setDrivers(
      (drv ?? [])
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
  }, [loadComms])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!draft) return
    return subscribePicks(draft.id, refresh)
  }, [draft, refresh])
  useEffect(() => {
    if (!draft) return
    return subscribeCommentary(draft.id, () => loadComms(draft.id))
  }, [draft, loadComms])
  useEffect(() => {
    fetch(`/api/championship?season=${CURRENT_SEASON}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setChamp({ drivers: d.drivers, constructors: d.constructors }) })
      .catch(() => {})
  }, [])

  const tab = (active: boolean): CSSProperties => ({
    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, border: '1px solid var(--line)',
    background: active ? 'var(--accent)' : 'var(--panel-2)', color: '#fff', fontWeight: 700,
  })

  if (!actingAs) return <NamePicker />

  // No draft open → the Draft tab shows the live F1 championship standings.
  if (!state || !draft) {
    return (
      <main style={{ padding: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>F1 Championship</h1>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>No draft open right now — the commissioner opens one in Admin.</p>
        <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          <button onClick={() => setChampView('drivers')} style={tab(champView === 'drivers')}>Drivers</button>
          <button onClick={() => setChampView('constructors')} style={tab(champView === 'constructors')}>Constructors</button>
        </div>
        {!champ ? (
          <p style={{ color: 'var(--muted)' }}>Loading…</p>
        ) : champView === 'drivers' ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {champ.drivers.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--line)', borderLeft: `4px solid ${TEAM_COLORS[d.constructorId] ?? '#888'}`, borderRadius: 10 }}>
                <span style={{ width: 26, color: d.champPos === 1 ? 'var(--warn)' : 'var(--muted)' }}>{d.champPos}</span>
                <span style={{ flex: 1, fontWeight: 700 }}>{d.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 10 }}>{d.team}</span>
                {d.points != null && <span style={{ fontWeight: 700 }}>{d.points}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {champ.constructors.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--line)', borderLeft: `4px solid ${c.color}`, borderRadius: 10 }}>
                <span style={{ width: 26, color: c.champPos === 1 ? 'var(--warn)' : 'var(--muted)' }}>{c.champPos}</span>
                <span style={{ flex: 1, fontWeight: 700 }}>{c.name}</span>
                {c.points != null && <span style={{ fontWeight: 700 }}>{c.points}</span>}
              </div>
            ))}
          </div>
        )}
      </main>
    )
  }

  const slot = onClock(state)
  const onClockName = slot ? players[slot.playerId]?.name ?? null : null
  const yours = slot?.playerId === actingAs.id

  async function pick(driverId: string) {
    if (!draft || !state || !actingAs) return
    try {
      await makePick(draft, state, driverId, actingAs.id)
      // Best-effort push: tell the next player it's their turn + others the pick.
      fetch('/api/push/notify-pick', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raceId: draft.race_id }),
      }).catch(() => {})
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

  const complete = !slot
  const saved = draft.status === 'locked'
  const driverById = new Map(drivers.map(d => [d.id, d]))
  const orderedPicks = [...state.picks].sort((a, b) => a.overall - b.overall)

  async function saveDraft() {
    if (!draft) return
    await supabase.from('drafts').update({ status: 'locked' }).eq('id', draft.id)
    await refresh()
  }

  return (
    <main>
      <div style={{ background: 'linear-gradient(90deg,#E8002D,#a80020)', padding: '12px 14px' }}>
        <div style={{ fontSize: 11, letterSpacing: 1, opacity: 0.85 }}>LIVE DRAFT</div>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{raceName}</div>
      </div>
      <OnTheClock name={onClockName} yours={yours} />
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)' }}>
        <EnableNotifications />
      </div>
      {commentary.length > 0 && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: 'var(--accent)', marginBottom: 6 }}>
            📣 THE BOOTH
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 132, overflowY: 'auto' }}>
            {[...commentary].reverse().slice(0, 6).map(c => (
              <div key={c.overall} style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text)', lineHeight: 1.35 }}>
                <span style={{ color: 'var(--muted)', fontStyle: 'normal' }}>#{c.overall} </span>
                {c.text}
              </div>
            ))}
          </div>
        </div>
      )}
      {actingAs.is_commissioner && last && !saved && (
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
      {complete ? (
        <div style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setView('players')}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, border: '1px solid var(--line)', background: view === 'players' ? 'var(--accent)' : 'var(--panel-2)', color: '#fff' }}
            >
              By player
            </button>
            <button
              onClick={() => setView('sequence')}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, border: '1px solid var(--line)', background: view === 'sequence' ? 'var(--accent)' : 'var(--panel-2)', color: '#fff' }}
            >
              Pick order
            </button>
          </div>

          {view === 'players'
            ? state.config.order.map(pid => {
                const roster = orderedPicks.filter(p => p.playerId === pid)
                const pl = players[pid]
                return (
                  <div key={pid} style={{ marginBottom: 12, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: 'var(--panel)', borderLeft: `4px solid ${pl?.color ?? '#888'}`, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PlayerAvatar name={pl?.name ?? 'Player'} color={pl?.color ?? '#888'} photoUrl={pl?.photoUrl} size={24} />
                      {pl?.name ?? 'Player'}
                    </div>
                    {roster.map(p => {
                      const d = driverById.get(p.driverId)
                      return (
                        <div key={p.overall} style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--line)' }}>
                          <span style={{ width: 24, color: 'var(--muted)', fontSize: 12 }}>#{p.overall}</span>
                          <span style={{ flex: 1, fontSize: 14 }}>
                            {d?.name ?? p.driverId}
                            {d?.team ? <span style={{ color: d.teamColor, fontSize: 12 }}> · {d.team}</span> : null}
                          </span>
                          {p.actorId !== p.playerId && (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>by {players[p.actorId]?.name ?? '?'}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })
            : (
                <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                  {orderedPicks.map(p => {
                    const d = driverById.get(p.driverId)
                    return (
                      <div key={p.overall} style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                        <span style={{ width: 26, color: 'var(--warn)', fontWeight: 700 }}>{p.overall}</span>
                        <span style={{ flex: 1, fontSize: 14 }}>
                          <b style={{ color: players[p.playerId]?.color ?? '#fff' }}>{players[p.playerId]?.name ?? 'Player'}</b>
                          {' → '}
                          {d?.name ?? p.driverId}
                          {d?.team ? <span style={{ color: d.teamColor, fontSize: 12 }}> · {d.team}</span> : null}
                          {p.actorId !== p.playerId && (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}> (by {players[p.actorId]?.name ?? '?'})</span>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

          {actingAs.is_commissioner && (
            <div style={{ marginTop: 16 }}>
              {saved ? (
                <p style={{ color: 'var(--live)', fontWeight: 700 }}>✓ Draft saved &amp; locked</p>
              ) : (
                <button
                  onClick={saveDraft}
                  style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: 'var(--live)', color: '#06210f', fontWeight: 800, fontSize: 15 }}
                >
                  💾 Save draft
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {drivers.map(d => (
            <DriverCard key={d.id} d={d} canPick={!!slot} onPick={() => pick(d.id)} />
          ))}
        </div>
      )}
    </main>
  )
}
