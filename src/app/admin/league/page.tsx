'use client'
import { useEffect, useState, CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'

const inp: CSSProperties = {
  background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', width: '100%',
}
const btn: CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 8, padding: '10px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
}

interface Settings {
  league_name: string
  draft_timing: 'before' | 'after'
  drivers_per_week: number
  draft_order_type: 'snake' | 'sequential'
  draft_order_basis: 'overall' | 'weekly'
  draft_open_day: number // 1=Mon … 6=Sat
}
const DEFAULTS: Settings = {
  league_name: 'FART-F1', draft_timing: 'after', drivers_per_week: 5,
  draft_order_type: 'sequential', draft_order_basis: 'overall', draft_open_day: 1,
}
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' },
]

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {hint && <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  )
}

function Toggle<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map(o => {
        const active = value === o.value
        return (
          <button key={o.value} onClick={() => onChange(o.value)}
            style={{
              ...btn, flex: 1, fontSize: 13,
              ...(active ? {} : { background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)' }),
            }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function LeagueSettingsPage() {
  const { actingAs } = usePlayer()
  const router = useRouter()
  const [s, setS] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('league_settings')
      .select('league_name,draft_timing,drivers_per_week,draft_order_type,draft_order_basis,draft_open_day').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setS({ ...DEFAULTS, ...data } as Settings); setLoaded(true) })
  }, [])

  if (!actingAs) return <NamePicker />
  if (!actingAs.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS(prev => ({ ...prev, [k]: v }))

  async function save() {
    setMsg('Saving…')
    const drivers = Math.max(1, Math.min(10, Math.round(Number(s.drivers_per_week) || 5)))
    const { error } = await supabase.from('league_settings').update({
      league_name: s.league_name.trim() || 'FART-F1',
      draft_timing: s.draft_timing,
      drivers_per_week: drivers,
      draft_order_type: s.draft_order_type,
      draft_order_basis: s.draft_order_basis,
      draft_open_day: s.draft_open_day,
    }).eq('id', 1)
    if (error) { setMsg(`Error: ${error.message}`); return }
    router.push('/admin')
  }

  return (
    <main style={{ padding: 16 }}>
      <Link href="/admin" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>← Commissioner</Link>
      <h1 style={{ fontSize: 22, marginTop: 6 }}>League Settings</h1>

      <Field label="League name" hint="Shown in branding and used by the AI commentary booth.">
        <input value={s.league_name} onChange={e => set('league_name', e.target.value)} style={inp} disabled={!loaded} />
      </Field>

      <Field label="Draft timing" hint="When each race's draft opens.">
        <Toggle value={s.draft_timing} onChange={v => set('draft_timing', v)} options={[
          { value: 'before', label: 'Pre-Qualifying' },
          { value: 'after', label: 'Post-Qualifying' },
        ]} />
      </Field>

      {s.draft_timing === 'before' && (
        <Field label="Draft opens on" hint="Pre-Qualifying only: the weekday the Draft Floor opens in each race week. The autopilot opens it (and pushes everyone) on this day.">
          <select value={s.draft_open_day} onChange={e => set('draft_open_day', Number(e.target.value))}
            style={{ ...inp, width: 160 }} disabled={!loaded}>
            {DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </Field>
      )}

      <Field label="Drivers per week" hint="How many drivers each player drafts each race.">
        <input type="number" min={1} max={10} value={s.drivers_per_week}
          onChange={e => set('drivers_per_week', Number(e.target.value))} style={{ ...inp, width: 100 }} disabled={!loaded} />
      </Field>

      <Field label="Draft order — sequence" hint="Snake reverses the order each round; sequential keeps the same order every round.">
        <Toggle value={s.draft_order_type} onChange={v => set('draft_order_type', v)} options={[
          { value: 'snake', label: 'Snake' },
          { value: 'sequential', label: 'Sequential' },
        ]} />
      </Field>

      <Field label="Draft order — who picks first" hint="Worst placed always picks first — by last week's result, or by the overall season standings.">
        <Toggle value={s.draft_order_basis} onChange={v => set('draft_order_basis', v)} options={[
          { value: 'weekly', label: 'Weekly loser first' },
          { value: 'overall', label: 'Overall standings' },
        ]} />
      </Field>

      <button onClick={save} style={{ ...btn, marginTop: 22 }} disabled={!loaded}>Save settings</button>
      <p style={{ color: 'var(--warn)', marginTop: 12 }}>{msg}</p>
    </main>
  )
}
