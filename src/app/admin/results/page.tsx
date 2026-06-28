'use client'
import { Suspense, useCallback, useEffect, useState, CSSProperties } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'
import { CURRENT_SEASON } from '@/lib/config'

const shortName = (n: string) => n.replace(/\s+Grand Prix$/i, '')

const inp: CSSProperties = {
  width: 56, textAlign: 'center', background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '6px 4px',
}
const btn: CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
}

interface Driver { id: string; name: string; grid: number | null }

function EnterResultsInner() {
  const { actingAs } = usePlayer()
  const qpRound = Number(useSearchParams().get('round') ?? 0)
  const [race, setRace] = useState<{ id: string; name: string; round: number } | null>(null)
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [pos, setPos] = useState<Record<string, string>>({})
  const [hasOfficial, setHasOfficial] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setMsg('')
    // Current race = the round passed in, else the most recent race that has happened.
    let r: { id: string; name: string; round: number } | null = null
    if (qpRound) {
      const { data } = await supabase.from('races').select('id,name,round').eq('season', CURRENT_SEASON).eq('round', qpRound).maybeSingle()
      r = data ?? null
    }
    if (!r) {
      const { data } = await supabase.from('races').select('id,name,round,date').eq('season', CURRENT_SEASON).order('round')
      const today = new Date().toISOString().slice(0, 10)
      const happened = (data ?? []).filter(x => x.date && x.date <= today)
      const pick = happened.length ? happened[happened.length - 1] : (data ?? [])[0]
      r = pick ? { id: pick.id, name: pick.name, round: pick.round } : null
    }
    setRace(r)
    if (!r) { setDrivers([]); return }

    // Drivers in this race = results ∪ qualifying, ordered by grid.
    const { data: res } = await supabase.from('results').select('driver_id,finish_position,provisional').eq('race_id', r.id)
    const { data: q } = await supabase.from('qualifying').select('driver_id,position').eq('race_id', r.id)
    const qpos = new Map((q ?? []).map(x => [x.driver_id, x.position]))
    const fpos = new Map((res ?? []).map(x => [x.driver_id, x.finish_position]))
    setHasOfficial((res ?? []).some(x => x.provisional === false))
    const ids = [...new Set([...(res ?? []).map(x => x.driver_id), ...(q ?? []).map(x => x.driver_id)])]
    ids.sort((a, b) => (qpos.get(a) ?? (fpos.get(a) ?? 99) + 100) - (qpos.get(b) ?? (fpos.get(b) ?? 99) + 100))

    let names = new Map<string, string>()
    if (ids.length) {
      const { data: drv } = await supabase.from('drivers').select('id,given_name,family_name').in('id', ids)
      names = new Map((drv ?? []).map(d => [d.id, `${d.given_name?.[0] ?? ''}. ${d.family_name}`]))
    }
    setDrivers(ids.map(id => ({ id, name: names.get(id) ?? id, grid: qpos.get(id) ?? null })))
    // Pre-fill with any finishing positions already stored.
    setPos(Object.fromEntries((res ?? []).map(x => [x.driver_id, String(x.finish_position)])))
  }, [qpRound])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (!actingAs) return <NamePicker />
  if (!actingAs.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  const city = race ? shortName(race.name) : '—'

  async function save() {
    if (!race) return
    setBusy(true); setMsg('Saving…')
    const gridById = new Map(drivers.map(d => [d.id, d.grid]))
    const rows = Object.entries(pos)
      .map(([driver_id, v]) => ({ driver_id, n: Math.round(Number(v)) }))
      .filter(({ n }) => Number.isFinite(n) && n > 0)
      .map(({ driver_id, n }) => ({
        race_id: race!.id, driver_id, finish_position: n,
        grid: gridById.get(driver_id) ?? null, status: 'Manual', provisional: true,
      }))
    if (!rows.length) { setBusy(false); setMsg('Enter at least one finishing position.'); return }
    const { error } = await supabase.from('results').upsert(rows, { onConflict: 'race_id,driver_id' })
    setBusy(false)
    setMsg(error ? `Error: ${error.message}` : `Saved ${rows.length} provisional results for ${city}. Standings updated; official results will overwrite these.`)
  }

  return (
    <main style={{ padding: 16 }}>
      <Link href="/admin" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>← Commissioner</Link>
      <h1 style={{ fontSize: 22, marginTop: 6 }}>Enter Results — {city}</h1>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
        Manually enter the finishing position for each driver (lowest = winner). These score immediately as
        <b> provisional</b> and are <b>automatically overwritten</b> when the official results post (~30 min after the race).
      </p>
      {hasOfficial && (
        <p style={{ color: 'var(--warn)', fontSize: 12, marginTop: 0 }}>
          Official results are already in for this race — manual edits here will be replaced on the next sync.
        </p>
      )}

      {drivers.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No grid for this race yet — tap “Update race results” on the Commissioner page first.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--muted)', padding: '0 4px' }}>
              <span style={{ width: 34 }}>Grid</span>
              <span style={{ flex: 1 }}>Driver</span>
              <span style={{ width: 56, textAlign: 'center' }}>Finish</span>
            </div>
            {drivers.map(d => (
              <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px' }}>
                <span style={{ width: 34, color: 'var(--muted)', fontSize: 13 }}>{d.grid != null ? `P${d.grid}` : '–'}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{d.name}</span>
                <input inputMode="numeric" value={pos[d.id] ?? ''}
                  onChange={e => setPos(p => ({ ...p, [d.id]: e.target.value }))} style={inp} />
              </div>
            ))}
          </div>
          <button onClick={save} style={{ ...btn, marginTop: 14 }} disabled={busy}>Save provisional results</button>
        </>
      )}
      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}

export default function EnterResultsPage() {
  return <Suspense fallback={<main style={{ padding: 16 }}>Loading…</main>}><EnterResultsInner /></Suspense>
}
