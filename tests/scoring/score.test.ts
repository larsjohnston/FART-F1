import { describe, it, expect } from 'vitest'
import { scoreRace, addToCumulative } from '@/lib/scoring/score'

const results = [
  { driverId: 'a', finishPosition: 1 }, { driverId: 'b', finishPosition: 2 },
  { driverId: 'c', finishPosition: 3 }, { driverId: 'd', finishPosition: 4 },
]
describe('scoreRace', () => {
  it('sums finishing positions per player (lower is better)', () => {
    const picks = { p1: ['a', 'd'], p2: ['b', 'c'] }  // p1: 1+4=5, p2: 2+3=5
    expect(scoreRace(picks, results)).toEqual({ p1: 5, p2: 5 })
  })
  it('treats a missing result as 0 contribution', () => {
    expect(scoreRace({ p1: ['z'] }, results)).toEqual({ p1: 0 })
  })
})
describe('addToCumulative', () => {
  it('adds weekly totals onto the running season totals', () => {
    expect(addToCumulative({ p1: 10, p2: 7 }, { p1: 5, p2: 5 })).toEqual({ p1: 15, p2: 12 })
  })
})
