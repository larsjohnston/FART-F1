'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { usePlayer, type Player } from '@/lib/players/context'

/** "Who are you?" selector. Shown on the home screen and inline anywhere the
 *  acting player is missing (e.g. Safari dropped the saved identity), so a null
 *  identity is never a dead end. */
export default function NamePicker({ onPicked }: { onPicked?: (p: Player) => void }) {
  const [players, setPlayers] = useState<Player[]>([])
  const { actingAs, setActingAs } = usePlayer()

  useEffect(() => {
    supabase.from('players').select('*').order('sort_order').then(({ data }) => setPlayers(data ?? []))
  }, [])

  return (
    <main style={{ padding: 20 }}>
      <div style={{ fontSize: 13, letterSpacing: 1, color: 'var(--accent)', fontWeight: 700 }}>FART-F1</div>
      <h1 style={{ fontSize: 24, marginTop: 4 }}>Who are you?</h1>
      <p style={{ color: 'var(--muted)' }}>Tap your name.</p>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {players.map(p => (
          <button
            key={p.id}
            onClick={() => { setActingAs(p); onPicked?.(p) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textAlign: 'left',
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: 'var(--panel-2)',
              color: 'var(--text)',
              borderLeft: `4px solid ${p.color}`,
              fontSize: 16,
            }}
          >
            {p.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.photo_url} alt={p.name}
                style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${p.color}`, flexShrink: 0 }} />
            ) : (
              <span style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', fontWeight: 800, border: `2px solid ${p.color}` }}>
                {p.name.slice(0, 1)}
              </span>
            )}
            <span>{p.name}{p.is_commissioner ? ' · 🏁 commish' : ''}{actingAs?.id === p.id ? ' ✓' : ''}</span>
          </button>
        ))}
      </div>
    </main>
  )
}
