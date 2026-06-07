import { describe, it, expect } from 'vitest'
import { computeOrder, onClock, applyPick, isComplete } from '@/lib/draft/engine'

const order = ['p1', 'p2', 'p3', 'p4']
const cfg = { order, rounds: 5 }

describe('computeOrder', () => {
  it('worst (most points) picks first', () => {
    const standings = [
      { playerId: 'p1', points: 50 },
      { playerId: 'p2', points: 80 },
      { playerId: 'p3', points: 60 },
      { playerId: 'p4', points: 70 },
    ]
    expect(computeOrder(standings)).toEqual(['p2', 'p4', 'p3', 'p1'])
  })
})

describe('onClock (straight order)', () => {
  it('first pick is order[0], overall 1, round 1', () => {
    expect(onClock({ config: cfg, picks: [] })).toEqual({ overall: 1, round: 1, playerId: 'p1' })
  })
  it('pick 5 wraps to order[0] in round 2 (straight, not snake)', () => {
    const picks = Array.from({ length: 4 }, (_, i) => ({
      overall: i + 1, round: 1, playerId: order[i], driverId: `d${i}`, actorId: order[i],
    }))
    expect(onClock({ config: cfg, picks })).toEqual({ overall: 5, round: 2, playerId: 'p1' })
  })
  it('returns null when all 20 picks are in', () => {
    const picks = Array.from({ length: 20 }, (_, i) => ({
      overall: i + 1, round: Math.floor(i / 4) + 1, playerId: order[i % 4], driverId: `d${i}`, actorId: order[i % 4],
    }))
    expect(onClock({ config: cfg, picks })).toBeNull()
    expect(isComplete({ config: cfg, picks })).toBe(true)
  })
})

describe('applyPick', () => {
  it('assigns the driver to the on-clock player and records the actor', () => {
    const s = applyPick({ config: cfg, picks: [] }, 'max_verstappen', 'p3') // p3 picks for p1
    expect(s.picks[0]).toMatchObject({ overall: 1, playerId: 'p1', actorId: 'p3', driverId: 'max_verstappen' })
  })
  it('rejects an already-drafted driver', () => {
    const s = applyPick({ config: cfg, picks: [] }, 'ver', 'p1')
    expect(() => applyPick(s, 'ver', 'p2')).toThrow(/already drafted/)
  })
  it('rejects picks once the draft is complete', () => {
    const picks = Array.from({ length: 20 }, (_, i) => ({
      overall: i + 1, round: Math.floor(i / 4) + 1, playerId: order[i % 4], driverId: `d${i}`, actorId: order[i % 4],
    }))
    expect(() => applyPick({ config: cfg, picks }, 'd99', 'p1')).toThrow(/complete/)
  })
})
