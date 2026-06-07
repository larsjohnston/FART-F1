import { describe, it, expect } from 'vitest'
import { scoreRace, addToCumulative, driverPoints, MAX_DRIVER_POINTS } from '@/lib/scoring/score'

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
  it('caps each driver at 20 points on a 22-car grid', () => {
    const r = [
      { driverId: 'x', finishPosition: 22 }, // -> 20
      { driverId: 'y', finishPosition: 21 }, // -> 20
      { driverId: 'z', finishPosition: 19 }, // -> 19
    ]
    expect(scoreRace({ p: ['x', 'y', 'z'] }, r)).toEqual({ p: 59 })
  })
})

describe('driverPoints', () => {
  it('is the finishing position, capped at 20', () => {
    expect(MAX_DRIVER_POINTS).toBe(20)
    expect(driverPoints(1)).toBe(1)
    expect(driverPoints(20)).toBe(20)
    expect(driverPoints(21)).toBe(20)
    expect(driverPoints(22)).toBe(20)
  })
})
describe('addToCumulative', () => {
  it('adds weekly totals onto the running season totals', () => {
    expect(addToCumulative({ p1: 10, p2: 7 }, { p1: 5, p2: 5 })).toEqual({ p1: 15, p2: 12 })
  })
})
