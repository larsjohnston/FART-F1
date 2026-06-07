import { serverClient } from '@/lib/supabase/server'
import {
  parseQualifying,
  parseResults,
  parseDriversFromResults,
  parseOpenF1,
} from './parse'

const JOLPICA = 'https://api.jolpi.ca/ergast/f1'

async function getJSON(url: string) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`)
  return res.json()
}

/** Sync one race round: drivers, constructors, qualifying, and results (if available). */
export async function syncRound(season: number, round: number) {
  const db = serverClient()

  const qualiJson = await getJSON(`${JOLPICA}/${season}/${round}/qualifying.json`)
  const raceMeta = qualiJson.MRData.RaceTable.Races[0]
  if (!raceMeta) throw new Error(`no race for ${season} round ${round}`)

  // Results may not exist before the race; tolerate fetch failure / empty Races.
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

  // Upsert race row
  const { data: raceRow, error: raceErr } = await db
    .from('races')
    .upsert(
      {
        season,
        round,
        name: raceMeta.raceName,
        date: raceMeta.date,
        status: resultsJson ? 'complete' : 'upcoming',
      },
      { onConflict: 'season,round' },
    )
    .select()
    .single()
  if (raceErr || !raceRow)
    throw new Error(`races upsert failed: ${raceErr?.message ?? 'no row'}`)
  const raceId = raceRow.id

  // Drivers + constructors come from results when raced; otherwise reshape the
  // qualifying JSON so parseDriversFromResults can pull from Driver + Constructor.
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

  const { error: cErr } = await db.from('constructors').upsert(
    constructors.map((c) => ({ id: c.id, name: c.name })),
    { onConflict: 'id' },
  )
  if (cErr) throw new Error(`constructors upsert failed: ${cErr.message}`)

  const { error: dErr } = await db.from('drivers').upsert(
    drivers.map((d) => ({
      id: d.id,
      code: d.code,
      number: d.number,
      given_name: d.givenName,
      family_name: d.familyName,
      constructor_id: d.constructorId,
      headshot_url: openf1[d.code]?.headshotUrl ?? null,
    })),
    { onConflict: 'id' },
  )
  if (dErr) throw new Error(`drivers upsert failed: ${dErr.message}`)

  // Enrich constructor colors from OpenF1 (any current driver on the team).
  for (const d of drivers) {
    const col = openf1[d.code]?.teamColour
    if (col)
      await db.from('constructors').update({ color: col }).eq('id', d.constructorId)
  }

  // Qualifying rows
  const q = parseQualifying(qualiJson)
  if (q.length) {
    const { error: qErr } = await db.from('qualifying').upsert(
      q.map((r) => ({ race_id: raceId, driver_id: r.driverId, position: r.position })),
      { onConflict: 'race_id,driver_id' },
    )
    if (qErr) throw new Error(`qualifying upsert failed: ${qErr.message}`)
  }

  // Results rows (if raced)
  if (resultsJson) {
    const rr = parseResults(resultsJson)
    const { error: resErr } = await db.from('results').upsert(
      rr.map((r) => ({
        race_id: raceId,
        driver_id: r.driverId,
        finish_position: r.finishPosition,
      })),
      { onConflict: 'race_id,driver_id' },
    )
    if (resErr) throw new Error(`results upsert failed: ${resErr.message}`)
  }

  return { raceId, raced: !!resultsJson, drivers: drivers.length }
}
