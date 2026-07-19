export interface RaceResult { driverId: string; finishPosition: number }

/**
 * Points per drafted driver, by the pool rule:
 * remove the undrafted drivers, then rank the drafted field by finishing
 * position — best drafted finisher = 1 point, worst = N (≤20). No ties, and
 * the two undrafted drivers never take up a rank.
 *
 * A drafted driver **with no result row ranks LAST**, not 0 — appended after
 * every classified driver (in stable order). This keeps a DNF / not-yet-synced
 * driver from beating a real finisher: while a race is on the provisional feed
 * its DNFs have no row, so they get the tail ranks (~19–20) instead of a
 * best-possible 0, and once the official classification syncs they sort into
 * their real positions. **Exception:** if the race has *no* results at all
 * (`finishByDriver` empty — unraced/future round) everyone scores 0, so an
 * unplayed week stays all-zero (and is skipped downstream) rather than handing
 * out phantom points. `finishByDriver` may be race results or, for a live
 * projection, the qualifying grid.
 */
export function rankDraftedPoints(
  draftedDriverIds: string[],
  finishByDriver: Map<string, number>,
): Map<string, number> {
  const pts = new Map<string, number>()
  if (finishByDriver.size === 0) return pts // no results yet → no points (unplayed week)
  const unique = [...new Set(draftedDriverIds)]
  const classified = unique
    .filter(d => finishByDriver.has(d))
    .sort((a, b) => (finishByDriver.get(a) as number) - (finishByDriver.get(b) as number))
  const missing = unique.filter(d => !finishByDriver.has(d)) // DNF / not classified yet → rank last
  ;[...classified, ...missing].forEach((d, i) => pts.set(d, i + 1))
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
