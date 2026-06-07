'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { usePlayer, type Player } from '@/lib/players/context'

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([])
  const { actingAs, setActingAs } = usePlayer()
  const router = useRouter()

  useEffect(() => {
    supabase
      .from('players')
      .select('*')
      .order('sort_order')
      .then(({ data }) => setPlayers(data ?? []))
  }, [])

  return (
    <main style={{ padding: 20 }}>
      <div style={{ fontSize: 13, letterSpacing: 1, color: 'var(--accent)', fontWeight: 700 }}>FART-F1</div>
      <h1 style={{ fontSize: 24, marginTop: 4 }}>Who are you?</h1>
      <p style={{ color: 'var(--muted)' }}>Tap your name to start drafting.</p>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {players.map(p => (
          <button
            key={p.id}
            onClick={() => { setActingAs(p); router.push('/draft') }}
            style={{
              textAlign: 'left',
              padding: '14px 16px',
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: 'var(--panel-2)',
              color: 'var(--text)',
              borderLeft: `4px solid ${p.color}`,
              fontSize: 16,
            }}
          >
            {p.name}{p.is_commissioner ? ' · 🏁 commish' : ''}
            {actingAs?.id === p.id ? ' ✓' : ''}
          </button>
        ))}
      </div>
    </main>
  )
}
