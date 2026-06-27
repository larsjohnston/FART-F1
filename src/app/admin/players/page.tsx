'use client'
import { useEffect, useRef, useState, CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { usePlayer } from '@/lib/players/context'
import NamePicker from '@/components/NamePicker'

const inp: CSSProperties = {
  background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', flex: 1, minWidth: 0,
}
const btn: CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 8, padding: '8px 12px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
}
const ghost: CSSProperties = { ...btn, background: 'transparent', border: '1px solid var(--line)', color: 'var(--text)' }

interface Row { id: string; name: string; color: string; photo_url: string | null }

// Resize an image file down to a small square-ish thumbnail and return a JPEG
// data URL — keeps the inline photo_url column tiny (no storage bucket needed).
function fileToThumb(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no canvas'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function Avatar({ row }: { row: Row }) {
  const size = 52
  const base: CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    border: `2px solid ${row.color}`, objectFit: 'cover',
  }
  if (row.photo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={row.photo_url} alt={row.name} style={base} />
  }
  return (
    <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel-2)', fontWeight: 800 }}>
      {row.name.slice(0, 1)}
    </div>
  )
}

function PlayerEditor({ row, onSaved }: { row: Row; onSaved: (r: Row) => void }) {
  const [name, setName] = useState(row.name)
  const [photo, setPhoto] = useState<string | null>(row.photo_url)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setMsg('')
      setPhoto(await fileToThumb(file))
    } catch {
      setMsg('Could not read that image.')
    }
  }

  async function save() {
    setBusy(true); setMsg('Saving…')
    const { error } = await supabase.from('players')
      .update({ name: name.trim() || row.name, photo_url: photo }).eq('id', row.id)
    setBusy(false)
    if (error) { setMsg(`Error: ${error.message}`); return }
    setMsg('Saved.')
    onSaved({ ...row, name: name.trim() || row.name, photo_url: photo })
  }

  const dirty = name.trim() !== row.name || photo !== row.photo_url

  return (
    <div style={{ border: '1px solid var(--line)', borderLeft: `4px solid ${row.color}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Avatar row={{ ...row, name, photo_url: photo }} />
        <input value={name} onChange={e => setName(e.target.value)} style={inp} />
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={() => fileRef.current?.click()} style={ghost}>{photo ? 'Change photo' : 'Add photo'}</button>
        {photo && <button onClick={() => setPhoto(null)} style={ghost}>Remove photo</button>}
        <button onClick={save} style={{ ...btn, marginLeft: 'auto', opacity: dirty && !busy ? 1 : 0.5 }} disabled={!dirty || busy}>Save</button>
      </div>
      {msg && <p style={{ color: 'var(--warn)', fontSize: 12, margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}

export default function PlayerSettingsPage() {
  const { actingAs } = usePlayer()
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    supabase.from('players').select('id,name,color,photo_url').order('sort_order')
      .then(({ data }) => setRows((data ?? []) as Row[]))
  }, [])

  if (!actingAs) return <NamePicker />
  if (!actingAs.is_commissioner) return <main style={{ padding: 20 }}>Commissioner only.</main>

  return (
    <main style={{ padding: 16 }}>
      <Link href="/admin" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>← Commissioner</Link>
      <h1 style={{ fontSize: 22, marginTop: 6 }}>Player Settings</h1>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
        Rename players and add a photo. Photos are stored small and show up wherever players appear.
      </p>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {rows.map(r => (
          <PlayerEditor key={r.id} row={r}
            onSaved={saved => setRows(rs => rs.map(x => (x.id === saved.id ? saved : x)))} />
        ))}
      </div>
    </main>
  )
}
