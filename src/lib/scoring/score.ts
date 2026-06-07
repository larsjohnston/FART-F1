export interface RaceResult { driverId: string; finishPosition: number }

/**
 * Points per drafted driver, by the pool rule:
 * remove the undrafted drivers, then rank the drafted field by finishing
 * position — best drafted finisher = 1 point, worst = N (≤20). No ties, and
 * the two undrafted drivers never take up a rank. Drivers with no result are
 * excluded (score 0). `finishByDriver` may be race results or, for a live
 * projection, the qualifying grid.
 */
export function rankDraftedPoints(
  draftedDriverIds: string[],
  finishByDriver: Map<string, number>,
): Map<string, number> {
  const ranked = [...new Set(draftedDriverIds)]
    .filter(d => finishByDriver.has(d))
    .sort((a, b) => (finishByDriver.get(a) as number) - (finishByDriver.get(b) as number))
  const pts = new Map<string, number>()
  ranked.forEach((d, i) => pts.set(d, i + 1))
  return pts
}

export function scoreRace(
  picksByPlayer: Record<string, string[]>,
  results: RaceResult[],
): Record<string, number> {
  const finish = new Map(results.map(r => [r.driverId, r.finishPosition]))
  const pts = rankDraftedPoints(Object.values(picksByPlayer).flat(), finish)
  const out: Record<string, number> = {}
  for (const [player, drivers] of Object.entries(picksByPlayer)) {
    out[player] = drivers.reduce((sum, d) => sum + (pts.get(d) ?? 0), 0)
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
