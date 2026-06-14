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
  grid: number
  status: string
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
    grid: Number(r.grid ?? 0),
    status: (r.status as string) ?? '',
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

/** Map OpenF1's `driver_number` -> Jolpica driverId, bridging via the shared
 *  three-letter code (OpenF1 `name_acronym` == our drivers.code). `codeToId`
 *  comes from the round's own driver list, so a number we can't resolve to a
 *  drafted driver is simply dropped. */
export function openF1NumberToId(
  openf1Drivers: any[],
  codeToId: Record<string, string>,
): Record<number, string> {
  const out: Record<number, string> = {}
  for (const d of openf1Drivers ?? []) {
    const id = codeToId[d.name_acronym]
    if (id && d.driver_number != null) out[Number(d.driver_number)] = id
  }
  return out
}

/** Provisional finishing order from OpenF1's `session_result` (published at the
 *  flag, before Jolpica's official classification). Skips entries we can't map
 *  to a driverId or that have no classified position. No grid is available from
 *  this feed — the official sync backfills it. */
export function parseOpenF1Results(
  sessionResult: any[],
  numberToId: Record<number, string>,
): ResultRow[] {
  const rows: ResultRow[] = []
  for (const r of sessionResult ?? []) {
    const driverId = numberToId[Number(r.driver_number)]
    const finishPosition = Number(r.position)
    if (!driverId || !Number.isFinite(finishPosition) || finishPosition <= 0) continue
    rows.push({
      driverId,
      finishPosition,
      grid: 0,
      status: r.dsq ? 'Disqualified' : r.dns ? 'Did not start' : r.dnf ? 'Retired' : 'Finished',
    })
  }
  return rows
}
