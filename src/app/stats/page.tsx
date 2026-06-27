'use client'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase/client'
import { CURRENT_SEASON } from '@/lib/config'
import { TEAM_COLORS } from '@/lib/f1/teamColors'

interface DriverStat {
  id: string; name: string; team: string; constructorId: string; races: number
  avgFinish: number; retired: number; retiredOf: number; posGained: number; last3: number[]; poolPoints: number; trackAvg: number | null
}
interface TopPick { name: string; count: number }
interface PlayerStat {
  id: string; name: string; color: string; picks: number; avgFinish: number | null
  topPicks: TopPick[]; bogey: string | null
  best: { driver: string; finish: number } | null; worst: { driver: string; finish: number } | null; weeklyWins: number
}
interface StatsData { ok: boolean; circuitName: string; drivers: DriverStat[]; players: PlayerStat[]; mostDrafted: TopPick[]; error?: string }

function Stat({ label, value }: { label: string; value: string }) {
  return <span><span style={{ color: 'var(--muted)' }}>{label}:</span> <b>{value}</b></span>
}

type Col = {
  key: string; label: [string, string]; num: boolean; align: 'left' | 'right'; defDir: 'asc' | 'desc'
  get: (d: DriverStat) => number | string | null
  cell: (d: DriverStat) => ReactNode
}
const COLS: Col[] = [
  { key: 'name', label: ['Driver', 'Team'], num: false, align: 'left', defDir: 'asc', get: d => d.name, cell: d => (<><div style={{ fontWeight: 700 }}>{d.name}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.team}</div></>) },
  { key: 'avgFinish', label: ['Avg', 'Finish'], num: true, align: 'right', defDir: 'asc', get: d => d.avgFinish || null, cell: d => (d.avgFinish ? `P${d.avgFinish}` : '–') },
  { key: 'dnf', label: ['', "DNF's"], num: true, align: 'right', defDir: 'asc', get: d => (d.retiredOf ? d.retired / d.retiredOf : null), cell: d => (d.retiredOf ? `${d.retired}/${d.retiredOf}` : '–') },
  { key: 'poolPoints', label: ['FART', 'Pts'], num: true, align: 'right', defDir: 'asc', get: d => d.poolPoints, cell: d => String(d.poolPoints) },
  { key: 'trackAvg', label: ['Track', 'Avg'], num: true, align: 'right', defDir: 'asc', get: d => d.trackAvg, cell: d => (d.trackAvg != null ? `P${d.trackAvg}` : '–') },
  { key: 'form', label: ['Last 3', 'Races'], num: true, align: 'right', defDir: 'asc', get: d => (d.last3.length ? d.last3.reduce((s, x) => s + x, 0) / d.last3.length : null), cell: d => (d.last3.map(p => `P${p}`).join(' ') || '–') },
]

export default function StatsPage() {
  const [view, setView] = useState<'drivers' | 'players'>('drivers')
  const [data, setData] = useState<StatsData | null>(null)
  const [err, setErr] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'avgFinish', dir: 'asc' })

  useEffect(() => {
    (async () => {
      const { data: drafts } = await supabase.from('drafts').select('race_id')
      const { data: races } = await supabase
        .from('races').select('id,round').eq('season', CURRENT_SEASON).order('round', { ascending: false })
      const draftRaces = new Set((drafts ?? []).map(d => d.race_id))
      const cur = (races ?? []).find(r => draftRaces.has(r.id))
      const round = cur?.round ?? 0
      try {
        const res = await fetch(`/api/stats?season=${CURRENT_SEASON}&round=${round}`).then(r => r.json())
        if (res.ok) setData(res)
        else setErr(res.error ?? 'failed')
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const tab = (active: boolean): CSSProperties => ({
    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, border: '1px solid var(--line)',
    background: active ? 'var(--accent)' : 'var(--panel-2)', color: '#fff', fontWeight: 700,
  })

  function toggleSort(c: Col) {
    setSort(s => (s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.defDir }))
  }

  const sortCol = COLS.find(c => c.key === sort.key) ?? COLS[1]
  const sortedDrivers = data
    ? [...data.drivers].sort((a, b) => {
        const av = sortCol.get(a), bv = sortCol.get(b)
        if (!sortCol.num) return sort.dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
      })
    : []

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Stats</h1>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button onClick={() => setView('drivers')} style={tab(view === 'drivers')}>Drivers</button>
        <button onClick={() => setView('players')} style={tab(view === 'players')}>Players</button>
      </div>

      {err && <p style={{ color: 'var(--warn)' }}>Couldn&apos;t load stats: {err}</p>}
      {!data && !err && <p style={{ color: 'var(--muted)' }}>Loading…</p>}

      {data && view === 'drivers' && (
        <>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
            Tap a column to sort.{data.circuitName ? ` Track Avg is at ${data.circuitName}, last 3 yrs.` : ''} Lower is better.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {COLS.map(c => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c)}
                      style={{
                        textAlign: c.align, padding: '6px 6px', cursor: 'pointer', whiteSpace: 'nowrap',
                        fontWeight: 600, borderBottom: '1px solid var(--line)', verticalAlign: 'bottom',
                        color: sort.key === c.key ? 'var(--text)' : 'var(--muted)',
                      }}
                    >
                      <div>{c.label[0]}</div>
                      <div>{c.label[1]}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDrivers.map(d => (
                  <tr key={d.id}>
                    {COLS.map((c, i) => (
                      <td
                        key={c.key}
                        style={{
                          textAlign: c.align, padding: '6px 6px', whiteSpace: 'nowrap', verticalAlign: 'middle',
                          borderBottom: '1px solid var(--line)',
                          borderLeft: i === 0 ? `3px solid ${TEAM_COLORS[d.constructorId] ?? '#888'}` : undefined,
                        }}
                      >
                        {c.cell(d)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && view === 'players' && (
        <>
          <div style={{ display: 'grid', gap: 10 }}>
            {data.players.map(p => (
              <div key={p.id} style={{ border: '1px solid var(--line)', borderLeft: `4px solid ${p.color}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ flex: 1, fontWeight: 800, fontSize: 16 }}>{p.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--warn)' }}>{p.weeklyWins} week win{p.weeklyWins === 1 ? '' : 's'}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6, fontSize: 12 }}>
                  <Stat label="Picks" value={String(p.picks)} />
                  <Stat label="Avg finish" value={p.avgFinish != null ? `P${p.avgFinish}` : '–'} />
                  <Stat label="Go-to" value={p.bogey ?? '–'} />
                </div>
                {(p.best || p.worst) && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    {p.best && <>Best: {p.best.driver} P{p.best.finish}</>}
                    {p.best && p.worst ? '  ·  ' : ''}
                    {p.worst && <>Worst: {p.worst.driver} P{p.worst.finish}</>}
                  </div>
                )}
                {p.topPicks.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    Most drafted: {p.topPicks.map(t => `${t.name} (${t.count})`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
          {data.mostDrafted.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 15 }}>Most fought-over (leaguewide)</h3>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                {data.mostDrafted.map(t => `${t.name} (${t.count})`).join('  ·  ')}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}
