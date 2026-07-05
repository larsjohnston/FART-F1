'use client'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase/client'
import { CURRENT_SEASON } from '@/lib/config'
import { TEAM_COLORS } from '@/lib/f1/teamColors'
import PlayerAvatar from '@/components/PlayerAvatar'

interface DriverStat {
  id: string; name: string; team: string; constructorId: string; races: number
  avgFinish: number; retired: number; retiredOf: number; posGained: number; last3: number[]; poolPoints: number; trackAvg: number | null
}
interface TopPick { name: string; count: number }
interface PlayerStat {
  id: string; name: string; color: string; photoUrl?: string | null
  avgPoints: number | null; bestWeek: number | null; worstWeek: number | null
  mostPicked: string | null; positions: number[]
}
interface Superlative { emoji: string; label: string; name: string; color: string; photoUrl: string | null; detail: string }
interface StatsData { ok: boolean; circuitName: string; drivers: DriverStat[]; players: PlayerStat[]; mostDrafted: TopPick[]; superlatives?: Superlative[]; error?: string }

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

type PCol = {
  key: string; label: [string, string]; num: boolean; align: 'left' | 'right'; defDir: 'asc' | 'desc'
  get: (p: PlayerStat) => number | string | null
  cell: (p: PlayerStat) => ReactNode
}
const PCOLS: PCol[] = [
  { key: 'name', label: ['Player', ''], num: false, align: 'left', defDir: 'asc', get: p => p.name, cell: p => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <PlayerAvatar name={p.name} color={p.color} photoUrl={p.photoUrl} size={26} />
      <span style={{ fontWeight: 700 }}>{p.name}</span>
    </span>
  ) },
  { key: 'avgPoints', label: ['Avg', 'Pts'], num: true, align: 'right', defDir: 'asc', get: p => p.avgPoints, cell: p => (p.avgPoints != null ? String(p.avgPoints) : '–') },
  { key: 'bestWeek', label: ['Best', 'Wk'], num: true, align: 'right', defDir: 'asc', get: p => p.bestWeek, cell: p => (p.bestWeek != null ? String(p.bestWeek) : '–') },
  { key: 'worstWeek', label: ['Worst', 'Wk'], num: true, align: 'right', defDir: 'desc', get: p => p.worstWeek, cell: p => (p.worstWeek != null ? String(p.worstWeek) : '–') },
  { key: 'mostPicked', label: ['Most', 'Picked'], num: false, align: 'left', defDir: 'asc', get: p => p.mostPicked, cell: p => p.mostPicked ?? '–' },
]

export default function StatsPage() {
  const [view, setView] = useState<'drivers' | 'players'>('drivers')
  const [data, setData] = useState<StatsData | null>(null)
  const [err, setErr] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'avgFinish', dir: 'asc' })
  const [psort, setPsort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'avgPoints', dir: 'asc' })

  useEffect(() => {
    (async () => {
      const { data: drafts } = await supabase.from('drafts').select('race_id')
      const { data: races } = await supabase
        .from('races').select('id,round,date').eq('season', CURRENT_SEASON).order('round', { ascending: false })
      const draftRaces = new Set((drafts ?? []).map(d => d.race_id))
      const today = new Date().toISOString().slice(0, 10)
      const rs = races ?? []
      // Current race for the Track Avg circuit: the latest race being drafted,
      // else the most recent race that's happened (pools with no in-app drafts,
      // e.g. backfilled history), else the earliest round.
      const cur = rs.find(r => draftRaces.has(r.id))
        ?? rs.find(r => r.date && r.date <= today)
        ?? rs[rs.length - 1]
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
  function togglePsort(c: PCol) {
    setPsort(s => (s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.defDir }))
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

  const psortCol = PCOLS.find(c => c.key === psort.key) ?? PCOLS[1]
  const sortedPlayers = data
    ? [...data.players].sort((a, b) => {
        const av = psortCol.get(a), bv = psortCol.get(b)
        if (!psortCol.num) return psort.dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return psort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
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
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
            This season ({CURRENT_SEASON}). Tap a column to sort. Points are golf-scored — lower is better. All-time stats live on the History tab.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {PCOLS.map(c => (
                    <th
                      key={c.key}
                      onClick={() => togglePsort(c)}
                      style={{
                        textAlign: c.align, padding: '6px 6px', cursor: 'pointer', whiteSpace: 'nowrap',
                        fontWeight: 600, borderBottom: '1px solid var(--line)', verticalAlign: 'bottom',
                        color: psort.key === c.key ? 'var(--text)' : 'var(--muted)',
                      }}
                    >
                      <div>{c.label[0]}</div>
                      <div>{c.label[1]}{psort.key === c.key ? (psort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map(p => (
                  <tr key={p.id}>
                    {PCOLS.map((c, i) => (
                      <td
                        key={c.key}
                        style={{
                          textAlign: c.align, padding: '6px 6px', whiteSpace: 'nowrap', verticalAlign: 'middle',
                          borderBottom: '1px solid var(--line)',
                          borderLeft: i === 0 ? `3px solid ${p.color}` : undefined,
                        }}
                      >
                        {c.cell(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Weekly finishing-position distribution this season. */}
          <h3 style={{ fontSize: 15, margin: '20px 0 6px' }}>Weekly finishes</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Player', '1st', '2nd', '3rd', '4th'].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '6px 6px', fontWeight: 600, color: 'var(--muted)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...data.players].sort((a, b) => (b.positions[0] ?? 0) - (a.positions[0] ?? 0)).map(p => (
                  <tr key={p.id}>
                    <td style={{ padding: '6px 6px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)', borderLeft: `3px solid ${p.color}` }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <PlayerAvatar name={p.name} color={p.color} photoUrl={p.photoUrl} size={26} />
                        <span style={{ fontWeight: 700 }}>{p.name}</span>
                      </span>
                    </td>
                    {[0, 1, 2, 3].map(i => (
                      <td key={i} style={{ textAlign: 'right', padding: '6px 6px', borderBottom: '1px solid var(--line)', color: (p.positions[i] ?? 0) === 0 ? 'var(--muted)' : 'var(--text)' }}>
                        {p.positions[i] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.superlatives && data.superlatives.length > 0 && (
            <>
              <h3 style={{ fontSize: 15, margin: '20px 0 6px' }}>Superlatives</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                {data.superlatives.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderLeft: `4px solid ${s.color}`, borderRadius: 10, padding: '10px 12px' }}>
                    <span style={{ fontSize: 20 }}>{s.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <PlayerAvatar name={s.name} color={s.color} photoUrl={s.photoUrl} size={22} />
                        <span style={{ fontWeight: 700 }}>{s.name}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', maxWidth: 150 }}>{s.detail}</span>
                  </div>
                ))}
              </div>
            </>
          )}

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
