'use client'
import { useEffect, useState, type CSSProperties } from 'react'

interface Standing { id: string; name: string; color: string; points: number }
interface SeasonData { standings: Standing[]; races: { race_no: number; pts: Record<string, number> }[]; complete: boolean }
interface CareerRow { id: string; name: string; color: string; points: number; titles: number }
interface PInfo { id: string; name: string; color: string }
interface Award { driver: string; count: number; avg: number }
interface WeekRec extends PInfo { season: number; race_no: number; points: number }
interface TitleRec { season: number; leader: PInfo; runnerUp: PInfo; margin: number }
interface Stats {
  weeklyWins: (PInfo & { wins: number })[]
  streaks: (PInfo & { streak: number })[]
  donkeys: (PInfo & { count: number })[]
  bestWeek: WeekRec | null
  worstWeek: WeekRec | null
  titleBiggest: TitleRec | null
  titleClosest: TitleRec | null
  driverAwards: Record<string, { golden: Award | null; letdown: Award | null }>
}
interface History {
  ok: boolean
  seasons: number[]
  players: { id: string; name: string; color: string }[]
  bySeason: Record<string, SeasonData>
  allTime: { totals: CareerRow[]; favorite: Record<string, { driver: string; count: number }> }
  stats: Stats
}

export default function HistoryPage() {
  const [data, setData] = useState<History | null>(null)
  const [err, setErr] = useState('')
  const [view, setView] = useState<'all' | number>('all')

  useEffect(() => {
    fetch('/api/history').then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error ?? 'failed') })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const chip = (active: boolean): CSSProperties => ({
    flex: '0 0 auto', padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
    border: '1px solid var(--line)', color: '#fff',
    background: active ? 'var(--accent)' : 'var(--panel-2)',
  })

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>History</h1>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>F.A.R.T. archive — golf scoring, lowest wins.</p>

      {err && <p style={{ color: 'var(--warn)' }}>Couldn&apos;t load: {err}</p>}
      {!data && !err && <p style={{ color: 'var(--muted)' }}>Loading…</p>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', margin: '12px 0' }}>
            <button onClick={() => setView('all')} style={chip(view === 'all')}>All-Time</button>
            {[...data.seasons].sort((a, b) => b - a).map(s => (
              <button key={s} onClick={() => setView(s)} style={chip(view === s)}>{s}</button>
            ))}
          </div>

          {view === 'all' ? (
            <>
              <div style={{ display: 'grid', gap: 6 }}>
                {data.allTime.totals.map((r, i) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: 'var(--panel-2)', border: '1px solid var(--line)', borderLeft: `4px solid ${r.color}`, borderRadius: 10 }}>
                    <span style={{ width: 22, color: i === 0 ? 'var(--warn)' : 'var(--muted)' }}>{i + 1}</span>
                    <span style={{ flex: 1, fontWeight: 700 }}>{r.name}</span>
                    <span style={{ marginRight: 12 }}>{'🏆'.repeat(r.titles) || '—'}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>{r.points.toLocaleString()} pts</span>
                  </div>
                ))}
              </div>
              <h3 style={{ fontSize: 15, marginTop: 18 }}>Most-drafted driver (career)</h3>
              <div style={{ display: 'grid', gap: 4 }}>
                {data.players.map(p => {
                  const f = data.allTime.favorite[p.id]
                  return (
                    <div key={p.id} style={{ display: 'flex', fontSize: 13, padding: '4px 0' }}>
                      <span style={{ width: 90, fontWeight: 700, color: p.color }}>{p.name}</span>
                      <span style={{ color: 'var(--muted)' }}>{f ? `${f.driver} (${f.count}×)` : '—'}</span>
                    </div>
                  )
                })}
              </div>
              {/* ---------------- All-Time fun stats ---------------- */}
              <h3 style={{ fontSize: 15, marginTop: 22 }}>Weekly wins (career)</h3>
              <div style={{ display: 'grid', gap: 4 }}>
                {(() => {
                  // Trophies scale to the leader so the rows reflect relative wins
                  // instead of all maxing out. The exact count sits on the right.
                  const maxWins = Math.max(1, ...data.stats.weeklyWins.map(r => r.wins))
                  return data.stats.weeklyWins.map(r => {
                    const n = r.wins > 0 ? Math.max(1, Math.round((r.wins / maxWins) * 10)) : 0
                    return (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
                        <span style={{ width: 90, fontWeight: 700, color: r.color }}>{r.name}</span>
                        <span style={{ flex: 1, letterSpacing: 1 }}>{'🏆'.repeat(n)}</span>
                        <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{r.wins}</span>
                      </div>
                    )
                  })
                })()}
              </div>

              <h3 style={{ fontSize: 15, marginTop: 18 }}>Records</h3>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                {data.stats.bestWeek && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span><span style={{ color: 'var(--live)', fontWeight: 700 }}>Best week</span> · {data.stats.bestWeek.name}</span>
                    <span style={{ color: 'var(--muted)' }}>{data.stats.bestWeek.points} pts · {data.stats.bestWeek.season} R{data.stats.bestWeek.race_no}</span>
                  </div>
                )}
                {data.stats.worstWeek && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span><span style={{ color: 'var(--warn)', fontWeight: 700 }}>Worst week</span> · {data.stats.worstWeek.name}</span>
                    <span style={{ color: 'var(--muted)' }}>{data.stats.worstWeek.points} pts · {data.stats.worstWeek.season} R{data.stats.worstWeek.race_no}</span>
                  </div>
                )}
                {data.stats.streaks[0] && data.stats.streaks[0].streak > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span><span style={{ fontWeight: 700 }}>Longest win streak</span> · {data.stats.streaks[0].name}</span>
                    <span style={{ color: 'var(--muted)' }}>{data.stats.streaks[0].streak} weeks in a row</span>
                  </div>
                )}
              </div>

              <h3 style={{ fontSize: 15, marginTop: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
                <img src="/donkey.svg" alt="" width={20} height={20} /> Donkey of the year
              </h3>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 6px' }}>Wooden spoon — finished last in a completed season.</p>
              <div style={{ display: 'grid', gap: 4 }}>
                {data.stats.donkeys.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
                    <span style={{ width: 90, fontWeight: 700, color: r.color }}>{r.name}</span>
                    <span style={{ flex: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      {Array.from({ length: r.count }).map((_, k) => <img key={k} src="/donkey.svg" alt="" width={16} height={16} />)}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>{r.count}</span>
                  </div>
                ))}
              </div>

              {(data.stats.titleBiggest || data.stats.titleClosest) && (
                <>
                  <h3 style={{ fontSize: 15, marginTop: 18 }}>Title margins</h3>
                  <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                    {data.stats.titleBiggest && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span><span style={{ fontWeight: 700 }}>Biggest blowout</span> · {data.stats.titleBiggest.season}</span>
                        <span style={{ color: 'var(--muted)' }}>{data.stats.titleBiggest.leader.name} by {data.stats.titleBiggest.margin}</span>
                      </div>
                    )}
                    {data.stats.titleClosest && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span><span style={{ fontWeight: 700 }}>Closest race</span> · {data.stats.titleClosest.season}</span>
                        <span style={{ color: 'var(--muted)' }}>
                          {data.stats.titleClosest.margin === 0
                            ? `${data.stats.titleClosest.leader.name} & ${data.stats.titleClosest.runnerUp.name} tied`
                            : `${data.stats.titleClosest.leader.name} by ${data.stats.titleClosest.margin}`}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}

              <h3 style={{ fontSize: 15, marginTop: 18 }}>Driver awards</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                {data.players.map(p => {
                  const da = data.stats.driverAwards[p.id]
                  if (!da || (!da.golden && !da.letdown)) return null
                  return (
                    <div key={p.id} style={{ fontSize: 13 }}>
                      <div style={{ fontWeight: 700, color: p.color }}>{p.name}</div>
                      {da.golden && <div style={{ color: 'var(--muted)' }}>🌟 Golden pick: {da.golden.driver} <span style={{ opacity: 0.7 }}>(avg P{da.golden.avg}, {da.golden.count}×)</span></div>}
                      {da.letdown && <div style={{ color: 'var(--muted)' }}>🫏 Biggest letdown: {da.letdown.driver} <span style={{ opacity: 0.7 }}>(avg P{da.letdown.avg}, {da.letdown.count}×)</span></div>}
                    </div>
                  )
                })}
              </div>

              <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 16 }}>🏆 = Season Titles</p>
            </>
          ) : (
            <SeasonView season={data.bySeason[String(view)]} players={data.players} year={view} />
          )}
        </>
      )}
    </main>
  )
}

function SeasonView({ season, players, year }: { season?: SeasonData; players: { id: string; name: string; color: string }[]; year: number }) {
  if (!season) return <p style={{ color: 'var(--muted)' }}>No data for {year}.</p>
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{year}</h2>
        {!season.complete && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: '#3a2f10', color: 'var(--warn)' }}>IN PROGRESS</span>}
      </div>
      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
        {season.standings.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: 'var(--panel-2)', border: '1px solid var(--line)', borderLeft: `4px solid ${r.color}`, borderRadius: 10 }}>
            <span style={{ width: 22, color: i === 0 ? 'var(--warn)' : 'var(--muted)' }}>{i + 1}</span>
            <span style={{ flex: 1, fontWeight: 700 }}>{r.name}{i === 0 && season.complete ? ' 🏆' : ''}</span>
            <span>{r.points.toLocaleString()}</span>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 15, marginTop: 18 }}>Race by race</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>R</th>
              {players.map(p => (
                <th key={p.id} style={{ textAlign: 'right', padding: '4px 6px', color: p.color, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {season.races.map(rc => {
              const vals = players.map(p => rc.pts[p.id]).filter(v => typeof v === 'number') as number[]
              const min = vals.length ? Math.min(...vals) : null
              return (
                <tr key={rc.race_no}>
                  <td style={{ padding: '4px 6px', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>{rc.race_no}</td>
                  {players.map(p => {
                    const v = rc.pts[p.id]
                    return (
                      <td key={p.id} style={{ textAlign: 'right', padding: '4px 6px', borderBottom: '1px solid var(--line)', color: v === min ? 'var(--live)' : 'var(--text)', fontWeight: v === min ? 700 : 400 }}>
                        {typeof v === 'number' ? v : '–'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
