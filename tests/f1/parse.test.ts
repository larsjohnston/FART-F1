import { describe, it, expect } from 'vitest'
import quali from '../fixtures/jolpica-qualifying.json'
import results from '../fixtures/jolpica-results.json'
import openf1 from '../fixtures/openf1-drivers.json'
import sessionResult from '../fixtures/openf1-session-result.json'
import {
  parseQualifying,
  parseResults,
  parseDriversFromResults,
  parseOpenF1,
  openF1NumberToId,
  parseOpenF1Results,
} from '@/lib/f1/parse'

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

describe('openF1NumberToId', () => {
  it('bridges driver_number -> driverId via the shared code', () => {
    const codeToId = { NOR: 'norris', VER: 'max_verstappen', LEC: 'leclerc' }
    const map = openF1NumberToId(openf1 as any, codeToId)
    expect(map[1]).toBe('norris')
    expect(map[3]).toBe('max_verstappen')
    // a code we don't have a Jolpica id for is dropped
    expect(map[44]).toBeUndefined()
  })
})

describe('parseOpenF1Results', () => {
  const numberToId: Record<number, string> = { 1: 'norris', 3: 'max_verstappen', 16: 'leclerc', 44: 'hamilton' }

  it('maps the provisional order and skips unmapped / unclassified entries', () => {
    const rows = parseOpenF1Results(sessionResult as any, numberToId)
    // #999 (unmapped) and #44 (null position, DNS) are dropped
    expect(rows).toHaveLength(3)
    expect(rows.find(r => r.driverId === 'norris')!.finishPosition).toBe(1)
    expect(rows.find(r => r.driverId === 'max_verstappen')!.finishPosition).toBe(2)
  })

  it('derives a classification status from dnf/dns/dsq flags', () => {
    const rows = parseOpenF1Results(sessionResult as any, numberToId)
    expect(rows.find(r => r.driverId === 'leclerc')!.status).toBe('Retired')
    expect(rows.find(r => r.driverId === 'norris')!.status).toBe('Finished')
  })
})
