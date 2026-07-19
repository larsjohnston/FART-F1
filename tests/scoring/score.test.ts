import { describe, it, expect } from 'vitest'
import { scoreRace, addToCumulative, rankDraftedPoints } from '@/lib/scoring/score'

describe('rankDraftedPoints', () => {
  it('ranks only the drafted drivers 1..N by finish; undrafted are removed', () => {
    // finishers P1..P6; c (P3) and e (P5) are undrafted → removed
    const finish = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5], ['f', 6]])
    const pts = rankDraftedPoints(['a', 'b', 'd', 'f'], finish)
    expect(Object.fromEntries(pts)).toEqual({ a: 1, b: 2, d: 3, f: 4 })
  })
  it('worst drafted finisher gets the top number', () => {
    const finish = new Map([['x', 22], ['y', 21], ['z', 1]])
    expect(Object.fromEntries(rankDraftedPoints(['x', 'y', 'z'], finish))).toEqual({ z: 1, y: 2, x: 3 })
  })
  it('a drafted driver with no result ranks LAST, not 0', () => {
    // a,b classified; d DNF (no row) → d must rank after every finisher, never beat one
    const finish = new Map([['a', 1], ['b', 2]])
    expect(Object.fromEntries(rankDraftedPoints(['a', 'b', 'd'], finish))).toEqual({ a: 1, b: 2, d: 3 })
  })
  it('multiple no-result drivers fill the tail ranks in order', () => {
    const finish = new Map([['a', 5], ['b', 3]])
    // classified by finish: b(3)→1, a(5)→2; then missing c,d get 3,4
    expect(Object.fromEntries(rankDraftedPoints(['a', 'b', 'c', 'd'], finish))).toEqual({ b: 1, a: 2, c: 3, d: 4 })
  })
  it('no results at all → empty map (unplayed week stays 0)', () => {
    expect(rankDraftedPoints(['a', 'b'], new Map()).size).toBe(0)
  })
})

describe('scoreRace', () => {
  const results = [
    { driverId: 'a', finishPosition: 1 }, { driverId: 'b', finishPosition: 2 },
    { driverId: 'c', finishPosition: 3 }, { driverId: 'd', finishPosition: 4 },
    { driverId: 'e', finishPosition: 5 }, { driverId: 'f', finishPosition: 6 },
  ]
  it('sums each player\'s drivers\' re-ranked points (undrafted removed first)', () => {
    // undrafted: c (P3), e (P5). drafted ranked: a→1, b→2, d→3, f→4
    const picks = { p1: ['a', 'd'], p2: ['b', 'f'] } // p1: 1+3=4, p2: 2+4=6
    expect(scoreRace(picks, results)).toEqual({ p1: 4, p2: 6 })
  })
  it('a DNF (no result) ranks last in the pool instead of scoring 0', () => {
    // pool a,b,zzz; a,b classified 1,2; zzz has no row → ranks last (3), not 0
    const picks = { p1: ['a', 'zzz'], p2: ['b'] } // p1: 1+3=4, p2: 2
    expect(scoreRace(picks, results)).toEqual({ p1: 4, p2: 2 })
  })
  it('an unraced week (no results) scores everyone 0', () => {
    expect(scoreRace({ p1: ['a', 'b'], p2: ['c'] }, [])).toEqual({ p1: 0, p2: 0 })
  })
})

describe('addToCumulative', () => {
  it('adds weekly totals onto the running season totals', () => {
    expect(addToCumulative({ p1: 10, p2: 7 }, { p1: 5, p2: 5 })).toEqual({ p1: 15, p2: 12 })
  })
})
