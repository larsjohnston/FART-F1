// Recent-form helpers for the Stats page "Last 5" column. Pure — no I/O.

export interface FormResult { round: number; finish: number; status: string | null }
export interface FormCell { round: number; finish: number; dnf: boolean }
export type Trend = 'up' | 'down' | 'flat' | null

const isClassified = (s: string) => s === 'Finished' || s === 'Lapped' || /^\+/.test(s)

/** A retirement/DSQ/DNS. 'Manual' (commissioner-entered preliminary rows) and a
 *  missing status are unknown, so never shown as a DNF. */
export function isDnf(status: string | null): boolean {
  if (!status || status === 'Manual') return false
  return !isClassified(status)
}

/** The most recent `n` race rounds that have any results, oldest first. Using the
 *  league-wide set of rounds (not each driver's own) means a driver who sat a race
 *  out shows a gap instead of silently reaching further back. */
export function lastRounds(allRounds: Iterable<number>, n = 5): number[] {
  return [...new Set(allRounds)].sort((a, b) => b - a).slice(0, n).sort((a, b) => a - b)
}

/** One cell per round (oldest → newest); null where the driver has no result. */
export function formCells(results: FormResult[], rounds: number[]): (FormCell | null)[] {
  const byRound = new Map(results.map(r => [r.round, r]))
  return rounds.map(rd => {
    const r = byRound.get(rd)
    return r ? { round: rd, finish: r.finish, dnf: isDnf(r.status) } : null
  })
}

/** Mean finish over the cells that have a result, or null if none. */
export function formAverage(cells: (FormCell | null)[]): number | null {
  const fs = cells.filter((c): c is FormCell => c !== null).map(c => c.finish)
  return fs.length ? fs.reduce((s, x) => s + x, 0) / fs.length : null
}

/** Direction of travel from a least-squares slope of finish position over the
 *  races run. Lower positions are better, so a negative slope is 'up'
 *  (improving). Needs at least 3 results; a swing under `threshold` places per
 *  race is 'flat'. */
export function formTrend(cells: (FormCell | null)[], threshold = 0.5): Trend {
  const pts = cells
    .map((c, i) => (c ? { x: i, y: c.finish } : null))
    .filter((p): p is { x: number; y: number } => p !== null)
  if (pts.length < 3) return null
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den
  if (slope <= -threshold) return 'up'
  if (slope >= threshold) return 'down'
  return 'flat'
}
