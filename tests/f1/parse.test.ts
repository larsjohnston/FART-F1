import { describe, it, expect } from 'vitest'
import quali from '../fixtures/jolpica-qualifying.json'
import results from '../fixtures/jolpica-results.json'
import openf1 from '../fixtures/openf1-drivers.json'
import { parseQualifying, parseResults, parseDriversFromResults, parseOpenF1 } from '@/lib/f1/parse'

describe('parseQualifying', () => {
  it('returns 20 rows sorted by position with driverId + position', () => {
    const rows = parseQualifying(quali as any)
    expect(rows).toHaveLength(20)
    expect(rows[0]).toMatchObject({ driverId: 'max_verstappen', position: 1 })
    expect(rows.every(r => typeof r.position === 'number')).toBe(true)
  })
})

describe('parseResults', () => {
  it('returns finishing positions keyed by driverId', () => {
    const rows = parseResults(results as any)
    expect(rows).toHaveLength(20)
    expect(rows.find(r => r.driverId === 'max_verstappen')!.finishPosition).toBe(1)
  })
})

describe('parseDriversFromResults', () => {
  it('extracts driver + constructor metadata', () => {
    const { drivers, constructors } = parseDriversFromResults(results as any)
    expect(drivers.find(d => d.id === 'max_verstappen')).toMatchObject({ code: 'VER', constructorId: 'red_bull' })
    expect(constructors.find(c => c.id === 'red_bull')).toBeTruthy()
  })
})

describe('parseOpenF1', () => {
  it('maps acronym -> headshot + team colour', () => {
    const map = parseOpenF1(openf1 as any)
    expect(map['VER']?.headshotUrl).toContain('http')
    expect(map['VER']?.teamColour).toMatch(/^#/)
  })
})
