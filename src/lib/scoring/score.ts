export interface RaceResult { driverId: string; finishPosition: number }

/** A driver can never cost more than this, even on a 22-car grid. */
export const MAX_DRIVER_POINTS = 20

/** Points a drafted driver contributes = finishing position, capped at 20. */
export function driverPoints(finishPosition: number): number {
  return Math.min(finishPosition, MAX_DRIVER_POINTS)
}

export function scoreRace(
  picksByPlayer: Record<string, string[]>,
  results: RaceResult[],
): Record<string, number> {
  const pos = new Map(results.map(r => [r.driverId, r.finishPosition]))
  const out: Record<string, number> = {}
  for (const [player, drivers] of Object.entries(picksByPlayer)) {
    out[player] = drivers.reduce((sum, d) => {
      const p = pos.get(d)
      return sum + (p == null ? 0 : driverPoints(p))
    }, 0)
  }
  return out
}

export function addToCumulative(
  season: Record<string, number>,
  week: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...season }
  for (const [player, pts] of Object.entries(week)) out[player] = (out[player] ?? 0) + pts
  return out
}
