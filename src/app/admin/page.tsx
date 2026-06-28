'use client'
import { useEffect, useState, CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import { CURRENT_SEASON, APP_MASTER, LEAGUES } from '@/lib/config'
import NamePicker from '@/components/NamePicker'

const btn: CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13,
  textDecoration: 'none', display: 'inline-block', textAlign: 'center', cursor: 'pointer',
}
const ghost: CSSProperties = { ...btn, background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)' }
const navBtn: CSSProperties = {
  ...btn, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '16px 16px', fontSize: 15,
}

const shortName = (n: string) => n.replace(/\s+Grand Prix$/i, '')

type Race = { id: string; round: number; name: string; date: string | null; status: string }

export default function AdminPage() {
  const { actingAs } = usePlayer()
  const [current, setCurrent] = useState<Race | null>(null)
  const [calendarLoaded, setCalendarLoaded] = useState(false)
  const [host, setHost] = useState('')
  const [msg, setMsg] = useState('')

  // Read the host after mount (avoids SSR/hydration mismatch) to highlight which
  // league this deployment is.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHost(window.location.host) }, [])

  async function loadCurrentRace() {
    const { data } = await supabase
      .from('races').select('id,round,name,date,status').eq('season', CURRENT_SEASON).order('round')
    const rs = (data ?? []) as Race[]
    if (!rs.length) { setCurrent(null); return }
    // The current race: a draft is open, else the most recent race that has
    // already happened (date ≤ today), else round 1.
    const today = new Date().toISOString().slice(0, 10)
    const drafting = rs.find(r => r.status === 'drafting')
    const happened = rs.filter(r => r.date && r.date <= today)
    setCurrent(drafting ?? (happened.length ? happened[happened.length - 1] : rs[0]))
  }

  // Run the autopilot automatically when the commissioner opens this page (in
  // addition to the daily cron): loads the calendar, syncs, completes finished
  // races and opens the next draft when its timing gate is met. Idempotent — no
  // manual "Advance now" button needed.
  useEffect(() => {
    if (!actingAs?.is_commissioner) return
    let cancelled = false
    ;(async () => {
      await loadCurrentRace() // show something immediately
      let opened: number | null = null
      try {
        const res = await fetch('/api/cron', { method: 'POST' }).then(r => r.json())
        opened = res?.opened ?? null
      } catch { /* best-effort — the daily cron also keeps things moving */ }
      if (!cancelled) {
        setCalendarLoaded(true)
        await loadCurrentRace()
        if (opened) setMsg(`Draft opened for round ${opened}. Players can pick now.`)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actingAs?.id])

  if (!actingAs) return <NamePicker />
  if (!actingAs.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  async function sync() {
    if (!current) return
    setMsg('Syncing…')
    const res = await fetch('/api/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ season: CURRENT_SEASON, round: current.round }),
    }).then(r => r.json())
    setMsg(
      !res.ok ? `Error: ${res.error}`
        : res.provisional ? `Provisional results synced — official will replace them once posted.`
        : res.raced ? `Results synced — ${res.drivers} drivers.`
        : res.qualified ? `Qualifying synced — ${res.drivers} drivers.`
        : 'On the calendar but not qualified yet — sync again after Saturday qualifying.',
    )
    await loadCurrentRace()
  }

  async function openDraftNow() {
    setMsg('Opening the draft…')
    const res = await fetch('/api/draft/open', { method: 'POST' }).then(r => r.json())
    if (!res.ok) { setMsg(`Error: ${res.error}`); return }
    await loadCurrentRace()
    setMsg(res.message ?? (res.opened ? `Draft opened for round ${res.opened}.` : 'Nothing to open.'))
  }

  const city = current ? shortName(current.name) : '—'

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Commissioner</h1>

      {APP_MASTER && (
        <section style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>App master · League</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {LEAGUES.map(l => {
              const isCurrent = host.includes(l.match)
              return isCurrent ? (
                <span key={l.id} style={{ ...btn, flex: 1, cursor: 'default', opacity: 1 }}>{l.name} ●</span>
              ) : (
                <a key={l.id} href={`${l.url}/admin`} style={{ ...ghost, flex: 1 }}>{l.name} →</a>
              )
            })}
          </div>
        </section>
      )}

      <section style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        <Link href="/admin/league" style={navBtn}>⚙️ League Settings <span>→</span></Link>
        <Link href="/admin/players" style={navBtn}>👤 Player Settings <span>→</span></Link>
        <Link href="/admin/history" style={navBtn}>📜 Re-write History <span>→</span></Link>
      </section>

      <section style={{ marginTop: 22, border: '1px solid var(--line)', borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Current race</div>
        <div style={{ fontWeight: 800, fontSize: 18, margin: '2px 0 10px' }}>
          {current ? `R${current.round} · ${city}` : (calendarLoaded ? 'No races yet' : 'Loading…')}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={openDraftNow} style={btn}>Open draft now</button>
          {current && <Link href={`/admin/order?round=${current.round}`} style={ghost}>Draft Order →</Link>}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          The season runs on autopilot — it advances daily and again every time you open this page (syncing,
          completing races and opening each draft on its timing, with a push to everyone). <b>Open draft now</b>
          opens the next race&rsquo;s draft immediately if you don&rsquo;t want to wait.
        </p>
      </section>

      <section style={{ marginTop: 16, border: '1px solid var(--line)', borderRadius: 10, padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={sync} style={btn} disabled={!current}>Update race results</button>
          {current && <Link href={`/admin/results?round=${current.round}`} style={ghost}>Enter results manually →</Link>}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Note: race results are delayed approximately 30 minutes. Enter them manually to score now —
          the official results overwrite your entries when they post.
        </p>
      </section>

      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}
