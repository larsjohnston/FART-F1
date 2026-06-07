'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { scoreRace, addToCumulative } from '@/lib/scoring/score'
import { CURRENT_SEASON } from '@/lib/config'

interface Row { name: string; points: number }

export default function StandingsPage() {
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    (async () => {
      const { data: players } = await supabase.from('players').select('id,name')
      const nameById: Record<string, string> = Object.fromEntries((players ?? []).map(p => [p.id, p.name]))

      const { data: races } = await supabase
        .from('races')
        .select('id')
        .eq('status', 'complete')
        .eq('season', CURRENT_SEASON)

      let cumulative: Record<string, number> = {}
      for (const r of races ?? []) {
        const { data: draft } = await supabase.from('drafts').select('id').eq('race_id', r.id).maybeSingle()
        if (!draft) continue
        const { data: picks } = await supabase
          .from('picks')
          .select('player_id,driver_id')
          .eq('draft_id', draft.id)
        const { data: results } = await supabase
          .from('results')
          .select('driver_id,finish_position')
          .eq('race_id', r.id)

        const byPlayer: Record<string, string[]> = {}
        for (const p of picks ?? []) (byPlayer[p.player_id] ??= []).push(p.driver_id)
        const week = scoreRace(
          byPlayer,
          (results ?? []).map(x => ({ driverId: x.driver_id, finishPosition: x.finish_position })),
        )
        cumulative = addToCumulative(cumulative, week)
      }

      setRows(
        Object.entries(cumulative)
          .map(([id, points]) => ({ name: nameById[id] ?? id, points }))
          .sort((a, b) => a.points - b.points), // low = leader
      )
    })()
  }, [])

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Championship</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>Lowest total wins (golf scoring).</p>
      <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
        {rows.map((r, i) => (
          <div
            key={r.name}
            style={{
              display: 'flex',
              padding: '10px 12px',
              background: 'var(--panel-2)',
              border: '1px solid var(--line)',
              borderRadius: 10,
            }}
          >
            <span style={{ width: 24, color: i === 0 ? 'var(--warn)' : 'var(--muted)' }}>{i + 1}</span>
            <span style={{ flex: 1, fontWeight: 700 }}>{r.name}</span>
            <span>{r.points}</span>
          </div>
        ))}
        {rows.length === 0 && <p style={{ color: 'var(--muted)' }}>No completed races scored yet.</p>}
      </div>
    </main>
  )
}
