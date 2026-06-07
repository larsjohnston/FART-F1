type Race = any
const race = (j: Race) => j.MRData.RaceTable.Races[0]

export interface QualifyingRow {
  driverId: string
  code: string
  position: number
}

export interface ResultRow {
  driverId: string
  finishPosition: number
}

export interface DriverMeta {
  id: string
  code: string
  number: number | null
  givenName: string
  familyName: string
  constructorId: string
}

export interface ConstructorMeta {
  id: string
  name: string
}

export interface OpenF1Entry {
  headshotUrl: string
  teamColour: string
  teamName: string
}

export function parseQualifying(j: Race): QualifyingRow[] {
  return (race(j)?.QualifyingResults ?? [])
    .map((q: any) => ({
      driverId: q.Driver.driverId as string,
      code: q.Driver.code as string,
      position: Number(q.position),
    }))
    .sort((a: QualifyingRow, b: QualifyingRow) => a.position - b.position)
}

export function parseResults(j: Race): ResultRow[] {
  return (race(j)?.Results ?? []).map((r: any) => ({
    driverId: r.Driver.driverId as string,
    finishPosition: Number(r.position),
  }))
}

export function parseDriversFromResults(j: Race): {
  drivers: DriverMeta[]
  constructors: ConstructorMeta[]
} {
  const rows = race(j)?.Results ?? []
  const drivers: DriverMeta[] = rows.map((r: any) => ({
    id: r.Driver.driverId as string,
    code: r.Driver.code as string,
    number: r.Driver.permanentNumber ? Number(r.Driver.permanentNumber) : null,
    givenName: r.Driver.givenName as string,
    familyName: r.Driver.familyName as string,
    constructorId: r.Constructor.constructorId as string,
  }))
  const cmap = new Map<string, ConstructorMeta>()
  for (const r of rows) {
    cmap.set(r.Constructor.constructorId, {
      id: r.Constructor.constructorId,
      name: r.Constructor.name,
    })
  }
  return { drivers, constructors: [...cmap.values()] }
}

export function parseOpenF1(arr: any[]): Record<string, OpenF1Entry> {
  const out: Record<string, OpenF1Entry> = {}
  for (const d of arr) {
    if (!d.name_acronym) continue
    out[d.name_acronym] = {
      headshotUrl: d.headshot_url ?? '',
      teamColour: d.team_colour ? `#${d.team_colour}` : '#888',
      teamName: d.team_name ?? '',
    }
  }
  return out
}
