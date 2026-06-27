'use client'
import { useEffect, useState, type CSSProperties } from 'react'
import { usePlayer } from '@/lib/players/context'

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const pill: CSSProperties = {
  background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)',
  borderRadius: 999, padding: '6px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
}

export default function EnableNotifications() {
  const { actingAs } = usePlayer()
  const [supported, setSupported] = useState(false)
  const [state, setState] = useState<'default' | 'granted' | 'denied'>('default')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Capability + permission detection must run client-side (browser APIs are
  // absent during SSR), so the synchronous setState here is intentional.
  useEffect(() => {
    const ok =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(ok)
    if (ok) setState(Notification.permission as 'default' | 'granted' | 'denied')
  }, [])

  if (!actingAs || !supported || !VAPID) return null

  async function enable() {
    setBusy(true); setMsg('')
    try {
      const perm = await Notification.requestPermission()
      setState(perm as 'default' | 'granted' | 'denied')
      if (perm !== 'granted') { setMsg('Notifications blocked — enable them in settings.'); return }
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID!),
        }))
      const res = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: actingAs!.id, subscription: sub.toJSON() }),
      }).then((r) => r.json())
      setMsg(res.ok ? 'Notifications on for this device 🏁' : `Error: ${res.error}`)
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Could not enable notifications')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'granted') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={enable} style={{ ...pill, borderColor: 'var(--live)', color: 'var(--live)' }} disabled={busy}>
          🔔 Notifications on
        </button>
        {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={enable} style={pill} disabled={busy}>
        {busy ? 'Enabling…' : '🔔 Notify me on my turn'}
      </button>
      {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
    </div>
  )
}
