import { describe, it, expect } from 'vitest'
import { isDnf, lastRounds, formCells, formAverage, formTrend, type FormCell } from '@/lib/stats/form'

const cell = (round: number, finish: number, dnf = false): FormCell => ({ round, finish, dnf })

describe('isDnf', () => {
  it('treats classified finishes as not DNF', () => {
    for (const s of ['Finished', 'Lapped', '+1 Lap', '+2 Laps']) expect(isDnf(s)).toBe(false)
  })
  it('treats retirements, DSQ and DNS as DNF', () => {
    for (const s of ['Retired', 'Accident', 'Engine', 'Disqualified', 'Did not start']) expect(isDnf(s)).toBe(true)
  })
  it('does not call unknown status a DNF (manual / missing)', () => {
    expect(isDnf('Manual')).toBe(false)
    expect(isDnf(null)).toBe(false)
    expect(isDnf('')).toBe(false)
  })
})

describe('lastRounds', () => {
  it('returns the newest n distinct rounds, oldest first', () => {
    expect(lastRounds([3, 1, 2, 3, 4, 5, 6, 7, 6], 5)).toEqual([3, 4, 5, 6, 7])
  })
  it('returns fewer when fewer rounds exist', () => {
    expect(lastRounds([2, 1], 5)).toEqual([1, 2])
    expect(lastRounds([], 5)).toEqual([])
  })
})

describe('formCells', () => {
  it('aligns to the given rounds and leaves a gap where the driver did not race', () => {
    const cells = formCells(
      [{ round: 4, finish: 8, status: 'Finished' }, { round: 6, finish: 20, status: 'Retired' }],
      [4, 5, 6],
    )
    expect(cells).toEqual([cell(4, 8), null, cell(6, 20, true)])
  })
})

describe('formAverage', () => {
  it('averages only the races run', () => {
    expect(formAverage([cell(1, 2), null, cell(3, 4)])).toBe(3)
  })
  it('is null with no results', () => {
    expect(formAverage([null, null])).toBeNull()
  })
})

describe('formTrend', () => {
  const run = (...fs: number[]) => fs.map((f, i) => cell(i + 1, f))
  it('is up (improving) when finishing positions fall', () => {
    expect(formTrend(run(12, 10, 8, 6, 4))).toBe('up')
  })
  it('is down when finishing positions rise', () => {
    expect(formTrend(run(3, 5, 8, 9, 14))).toBe('down')
  })
  it('is flat for steady results', () => {
    expect(formTrend(run(7, 8, 7, 8, 7))).toBe('flat')
  })
  it('needs at least 3 results', () => {
    expect(formTrend(run(1, 20))).toBeNull()
    expect(formTrend([cell(1, 5), null, null, null, cell(5, 2)])).toBeNull()
  })
  it('skips gaps but keeps the time spacing', () => {
    expect(formTrend([cell(1, 15), null, cell(3, 9), null, cell(5, 3)])).toBe('up')
  })
})
