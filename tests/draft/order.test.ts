import { describe, it, expect, vi } from 'vitest'

// standings.ts imports the browser Supabase client, which reads env at module
// load. The function under test is pure, so stub the client out.
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { draftOrderFromStandings } from '@/lib/standings'

const s = (id: string, points: number) => ({ id, points })
const tiebreak = ['a', 'b', 'c', 'd']

describe('draftOrderFromStandings', () => {
  it('puts the worst-placed (most points) first', () => {
    const order = draftOrderFromStandings([s('a', 100), s('b', 300), s('c', 200), s('d', 50)], tiebreak)
    expect(order).toEqual(['b', 'c', 'a', 'd'])
  })

  it('breaks an overall tie by who was TRAILING going into the week (more prior points drafts first)', () => {
    // b and c tied on 959 now. c was further behind a week ago (900 vs 850),
    // so c drafts ahead of b. Regression: #83 shipped this backwards.
    const order = draftOrderFromStandings(
      [s('a', 500), s('b', 959), s('c', 959), s('d', 700)],
      tiebreak,
      [s('a', 480), s('b', 850), s('c', 900), s('d', 680)],
    )
    expect(order).toEqual(['c', 'b', 'd', 'a'])
  })

  it('matches the real FART A round 19 case: Mendo (was trailing) drafts ahead of Ned', () => {
    const order = draftOrderFromStandings(
      [s('tamags', 1000), s('ned', 959), s('mendo', 959), s('tup', 800)],
      ['tamags', 'ned', 'mendo', 'tup'],
      [s('tamags', 940), s('ned', 880), s('mendo', 905), s('tup', 770)],
    )
    expect(order.indexOf('mendo')).toBeLessThan(order.indexOf('ned'))
  })

  it('does not let the prior-standings tiebreak override a real points difference', () => {
    // a leads the prior standings by a lot, but has more points NOW, so still first.
    const order = draftOrderFromStandings(
      [s('a', 400), s('b', 300)],
      ['a', 'b'],
      [s('a', 10), s('b', 290)],
    )
    expect(order).toEqual(['a', 'b'])
  })

  it('falls back to the given order when tied now AND tied before', () => {
    const order = draftOrderFromStandings(
      [s('d', 100), s('c', 100), s('b', 100), s('a', 100)],
      tiebreak,
      [s('a', 50), s('b', 50), s('c', 50), s('d', 50)],
    )
    expect(order).toEqual(['a', 'b', 'c', 'd'])
  })

  it('falls back to the given order when no prior standings are supplied (weekly basis)', () => {
    const order = draftOrderFromStandings([s('c', 7), s('b', 7), s('a', 9), s('d', 1)], tiebreak)
    expect(order).toEqual(['a', 'b', 'c', 'd'])
  })

  it('treats a player missing from the prior standings as 0 prior points', () => {
    const order = draftOrderFromStandings([s('a', 10), s('b', 10)], ['a', 'b'], [s('a', 5)])
    // a had 5 prior, b had none (0) -> a was trailing more -> a first
    expect(order).toEqual(['a', 'b'])
  })

  it('does not mutate the input standings', () => {
    const input = [s('a', 1), s('b', 2)]
    draftOrderFromStandings(input, ['a', 'b'])
    expect(input).toEqual([s('a', 1), s('b', 2)])
  })
})
