import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

// Load .env.local so we have DB creds and any overrides.
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const raw = readFileSync(resolve(root, '.env.local'), 'utf8')
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (!m) continue
  const [, k, v] = m
  let val = v
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1)
  }
  if (!process.env[k]) process.env[k] = val
}

// Import parsers AFTER env load (consistent with route-handler pattern).
const { parseQualifying, parseResults, parseDriversFromResults, parseOpenF1 } =
  await import('../src/lib/f1/parse')

const JOLPICA = 'https://api.jolpi.ca/ergast/f1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJSON(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`)
  return res.json()
}

// Parse a postgres URL where the password may contain raw special characters.
function parsePgUrl(url: string) {
  const schemeMatch = url.match(/^([a-z]+):\/\//i)
  if (!schemeMatch) throw new Error('not a postgres URL')
  const after = url.slice(schemeMatch[0].length)
  const lastAt = after.lastIndexOf('@')
  if (lastAt < 0) throw new Error('no @ in URL')
  const userinfo = after.slice(0, lastAt)
  const hostPart = after.slice(lastAt + 1)
  const firstColon = userinfo.indexOf(':')
  const user = firstColon < 0 ? userinfo : userinfo.slice(0, firstColon)
  const password = firstColon < 0 ? '' : userinfo.slice(firstColon + 1)
  const qIdx = hostPart.indexOf('?')
  const beforeQuery = qIdx < 0 ? hostPart : hostPart.slice(0, qIdx)
  const slashIdx = beforeQuery.indexOf('/')
  const hostport = slashIdx < 0 ? beforeQuery : beforeQuery.slice(0, slashIdx)
  const database = slashIdx < 0 ? '' : beforeQuery.slice(slashIdx + 1)
  const [host, portStr] = hostport.split(':')
  const port = portStr ? parseInt(portStr, 10) : 5432
  return { host, port, user, password, database }
}

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set in .env.local')
  process.exit(1)
}
const cfg = parsePgUrl(dbUrl)
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false } })
await client.connect()

/** Direct-Postgres mirror of syncRound() for autonomous backfill. Mirrors the
 * same parser-driven flow as src/lib/f1/sync.ts but bypasses PostgREST so the
 * backfill can run with only SUPABASE_DB_URL (no PostgREST keys needed). */
async function syncRoundDirect(season: number, round: number) {
  const qualiJson = await getJSON(
    `${JOLPICA}/${season}/${round}/qualifying.json`,
  )
  const raceMeta = qualiJson.MRData.RaceTable.Races[0]
  if (!raceMeta) throw new Error(`no race for ${season} round ${round}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resultsJson: any = null
  try {
    const rj = await getJSON(`${JOLPICA}/${season}/${round}/results.json`)
    if (rj?.MRData?.RaceTable?.Races?.[0]?.Results?.length) resultsJson = rj
  } catch {
    // not raced yet
  }

  const openf1 = parseOpenF1(
    await getJSON('https://api.openf1.org/v1/drivers?session_key=latest'),
  )

  const status = resultsJson ? 'complete' : 'upcoming'
  const raceRes = await client.query(
    `insert into races (season, round, name, date, status)
     values ($1, $2, $3, $4, $5)
     on conflict (season, round) do update
       set name = excluded.name, date = excluded.date, status = excluded.status
     returning id`,
    [season, round, raceMeta.raceName, raceMeta.date, status],
  )
  const raceId: string = raceRes.rows[0].id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let driverPayload: any
  if (resultsJson) {
    driverPayload = resultsJson
  } else {
    driverPayload = {
      MRData: {
        RaceTable: {
          Races: [
            {
              Results: (raceMeta.QualifyingResults ?? []).map(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (q: any) => ({
                  Driver: q.Driver,
                  Constructor: q.Constructor,
                  position: q.position,
                }),
              ),
            },
          ],
        },
      },
    }
  }
  const { drivers, constructors } = parseDriversFromResults(driverPayload)

  for (const c of constructors) {
    await client.query(
      `insert into constructors (id, name) values ($1, $2)
       on conflict (id) do update set name = excluded.name`,
      [c.id, c.name],
    )
  }

  for (const d of drivers) {
    await client.query(
      `insert into drivers (id, code, number, given_name, family_name, constructor_id, headshot_url)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         code = excluded.code,
         number = excluded.number,
         given_name = excluded.given_name,
         family_name = excluded.family_name,
         constructor_id = excluded.constructor_id,
         headshot_url = coalesce(excluded.headshot_url, drivers.headshot_url)`,
      [
        d.id,
        d.code,
        d.number,
        d.givenName,
        d.familyName,
        d.constructorId,
        openf1[d.code]?.headshotUrl ?? null,
      ],
    )
  }

  // Enrich constructor colors from OpenF1 where available.
  for (const d of drivers) {
    const col = openf1[d.code]?.teamColour
    if (col) {
      await client.query(`update constructors set color = $1 where id = $2`, [
        col,
        d.constructorId,
      ])
    }
  }

  const q = parseQualifying(qualiJson)
  for (const r of q) {
    await client.query(
      `insert into qualifying (race_id, driver_id, position) values ($1, $2, $3)
       on conflict (race_id, driver_id) do update set position = excluded.position`,
      [raceId, r.driverId, r.position],
    )
  }

  if (resultsJson) {
    const rr = parseResults(resultsJson)
    for (const r of rr) {
      await client.query(
        `insert into results (race_id, driver_id, finish_position) values ($1, $2, $3)
         on conflict (race_id, driver_id) do update set finish_position = excluded.finish_position`,
        [raceId, r.driverId, r.finishPosition],
      )
    }
  }

  return { raceId, raced: !!resultsJson, drivers: drivers.length }
}

// Hard-default to 2024 for the M1 bootstrap (the .env.local F1_SEASON override
// is reserved for future seasons). Override via the optional second CLI arg.
const season = Number(process.argv[3] ?? '2024')
const maxRounds = Number(process.argv[2] ?? '24')

const results: Array<{
  round: number
  ok: boolean
  raced?: boolean
  drivers?: number
  error?: string
}> = []

try {
  for (let round = 1; round <= maxRounds; round++) {
    try {
      const out = await syncRoundDirect(season, round)
      console.log(
        `[${season} R${round}] ok — raced=${out.raced} drivers=${out.drivers}`,
      )
      results.push({ round, ok: true, raced: out.raced, drivers: out.drivers })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`[${season} R${round}] skipped — ${msg}`)
      results.push({ round, ok: false, error: msg })
      if (msg.includes('no race')) break
    }
  }
} finally {
  await client.end()
}

const synced = results.filter((r) => r.ok).length
const raced = results.filter((r) => r.ok && r.raced).length
console.log(
  `\nDone. ${synced}/${results.length} rounds synced, ${raced} with race results.`,
)
