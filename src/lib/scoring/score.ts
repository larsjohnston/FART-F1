export interface RaceResult { driverId: string; finishPosition: number }

export function scoreRace(
  picksByPlayer: Record<string, string[]>,
  results: RaceResult[],
): Record<string, number> {
  const pos = new Map(results.map(r => [r.driverId, r.finishPosition]))
  const out: Record<string, number> = {}
  for (const [player, drivers] of Object.entries(picksByPlayer)) {
    out[player] = drivers.reduce((sum, d) => sum + (pos.get(d) ?? 0), 0)
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
