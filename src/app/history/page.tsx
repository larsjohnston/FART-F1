'use client'
import { useEffect, useState, type CSSProperties } from 'react'

interface Standing { id: string; name: string; color: string; points: number }
interface SeasonData { standings: Standing[]; races: { race_no: number; pts: Record<string, number> }[]; complete: boolean }
interface CareerRow { id: string; name: string; color: string; points: number; titles: number }
interface History {
  ok: boolean
  seasons: number[]
  players: { id: string; name: string; color: string }[]
  bySeason: Record<string, SeasonData>
  allTime: { totals: CareerRow[]; favorite: Record<string, { driver: string; count: number }> }
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
              <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 12 }}>🏆 = season title (completed seasons). Current season excluded until it finishes.</p>
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
