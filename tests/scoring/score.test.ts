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
  it('treats a driver with no result as 0 contribution', () => {
    expect(scoreRace({ p1: ['zzz'] }, results)).toEqual({ p1: 0 })
  })
})

describe('addToCumulative', () => {
  it('adds weekly totals onto the running season totals', () => {
    expect(addToCumulative({ p1: 10, p2: 7 }, { p1: 5, p2: 5 })).toEqual({ p1: 15, p2: 12 })
  })
})
