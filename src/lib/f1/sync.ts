import { serverClient } from '@/lib/supabase/server'
import { CURRENT_SEASON } from '@/lib/config'
import {
  parseQualifying,
  parseResults,
  parseDriversFromResults,
  parseOpenF1,
  openF1NumberToId,
  parseOpenF1Results,
} from './parse'
import { TEAM_COLORS } from './teamColors'

const JOLPICA = 'https://api.jolpi.ca/ergast/f1'
const OPENF1 = 'https://api.openf1.org/v1'

/** Official results are authoritative once posted; until then (and never past
 *  this window) we may show OpenF1's provisional order. */
const PROVISIONAL_WINDOW_MIN = 60

async function getJSON(url: string) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`)
  return res.json()
}

/** Sync one race round: drivers, constructors, qualifying, and results (if available). */
export async function syncRound(season: number, round: number) {
  const db = serverClient()

  // Race meta comes from the SCHEDULE endpoint — it exists as soon as the season
  // calendar is published, so a round that hasn't qualified yet still resolves
  // (instead of failing with a misleading "no race" error).
  const schedJson = await getJSON(`${JOLPICA}/${season}/${round}.json`)
  const raceMeta = schedJson.MRData.RaceTable.Races[0]
  if (!raceMeta) throw new Error(`Round ${round} isn’t on the ${season} F1 calendar.`)

  // Qualifying may not be posted yet (empty until the Saturday session).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let qualiJson: any = null
  try {
    const qj = await getJSON(`${JOLPICA}/${season}/${round}/qualifying.json`)
    if (qj?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults?.length) qualiJson = qj
  } catch {
    // not qualified yet
  }

  // Results may not exist before the race; tolerate fetch failure / empty Races.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resultsJson: any = null
  try {
    const rj = await getJSON(`${JOLPICA}/${season}/${round}/results.json`)
    if (rj?.MRData?.RaceTable?.Races?.[0]?.Results?.length) resultsJson = rj
  } catch {
    // not raced yet
  }

  // OpenF1 supplies driver headshots + live livery colors, but it is cosmetic
  // and locks down to paid users *during a live session* (i.e. while the race is
  // running). Never let it block the core Jolpica draft data — cards fall back to
  // colored initials, and TEAM_COLORS covers team colors.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openf1Raw: any[] = []
  let openf1: Record<string, { headshotUrl: string; teamColour: string; teamName: string }> = {}
  try {
    openf1Raw = await getJSON(`${OPENF1}/drivers?session_key=latest`)
    openf1 = parseOpenF1(openf1Raw)
  } catch {
    // headshots/colors unavailable this run
  }

  // OpenF1 publishes the provisional finishing order at the flag — minutes ahead
  // of Jolpica's official classification. Fetch the latest session + its result,
  // but only trust it if that session is THIS round's race (matched by date), so
  // a stale "latest" session can never bleed onto the wrong round. Once the
  // session has ended the result drops into OpenF1's free tier; tolerate any
  // failure (paid lock mid-race, outage) and fall back to the official path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openf1Result: any[] = []
  let openf1RaceEndMs: number | null = null
  let openf1MatchesRound = false
  try {
    const sessions = await getJSON(`${OPENF1}/sessions?session_key=latest`)
    const sess = Array.isArray(sessions) ? sessions[0] : null
    const isRace = sess?.session_type === 'Race' || sess?.session_name === 'Race'
    if (sess && isRace && sess.year === season && sess.date_start?.slice(0, 10) === raceMeta.date) {
      openf1MatchesRound = true
      openf1RaceEndMs = sess.date_end ? Date.parse(sess.date_end) : null
      openf1Result = await getJSON(`${OPENF1}/session_result?session_key=latest`)
    }
  } catch {
    // provisional feed unavailable this run
  }

  // Pulling results does NOT auto-score the race: preserve an in-progress
  // 'drafting' (or already 'complete') status so the commissioner can verify in
  // This Week, then explicitly Close & score. Only a brand-new round that's
  // already raced lands as 'complete'.
  const { data: existing } = await db
    .from('races').select('status').eq('season', season).eq('round', round).maybeSingle()
  const status =
    existing?.status === 'drafting' || existing?.status === 'complete'
      ? existing.status
      : resultsJson
        ? 'complete'
        : 'upcoming'

  // Upsert race row
  const { data: raceRow, error: raceErr } = await db
    .from('races')
    .upsert(
      { season, round, name: raceMeta.raceName, date: raceMeta.date, status },
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
  } else if (qualiJson) {
    driverPayload = {
      MRData: {
        RaceTable: {
          Races: [
            {
              Results: (qualiJson.MRData.RaceTable.Races[0].QualifyingResults ?? []).map(
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
  } else {
    // Round on the calendar but not yet qualified — no drivers to add this run.
    driverPayload = { MRData: { RaceTable: { Races: [{ Results: [] }] } } }
  }
  const { drivers, constructors } = parseDriversFromResults(driverPayload)

  const { error: cErr } = await db.from('constructors').upsert(
    constructors.map((c) => ({ id: c.id, name: c.name, color: TEAM_COLORS[c.id] ?? '#888' })),
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
  const q = qualiJson ? parseQualifying(qualiJson) : []
  if (q.length) {
    const { error: qErr } = await db.from('qualifying').upsert(
      q.map((r) => ({ race_id: raceId, driver_id: r.driverId, position: r.position })),
      { onConflict: 'race_id,driver_id' },
    )
    if (qErr) throw new Error(`qualifying upsert failed: ${qErr.message}`)
  }

  // Results rows: prefer Jolpica's official classification; until it posts (and
  // only within the first hour after the flag) fall back to OpenF1's provisional
  // order so standings appear fast. Past the window, official is required and
  // overwrites any provisional rows already stored.
  const codeToId = Object.fromEntries(drivers.map((d) => [d.code, d.id]))
  const numberToId = openF1NumberToId(openf1Raw, codeToId)
  const provisionalRows = openf1MatchesRound ? parseOpenF1Results(openf1Result, numberToId) : []

  const raceEndMs =
    openf1RaceEndMs ??
    (raceMeta.time ? Date.parse(`${raceMeta.date}T${raceMeta.time}`) + 2 * 60 * 60 * 1000 : null)
  const minsSinceEnd = raceEndMs == null ? Infinity : (Date.now() - raceEndMs) / 60000

  let writeRows: ReturnType<typeof parseResults> | null = null
  let provisional = false
  if (resultsJson && (minsSinceEnd >= PROVISIONAL_WINDOW_MIN || !provisionalRows.length)) {
    writeRows = parseResults(resultsJson) // official — penalties applied
  } else if (provisionalRows.length) {
    writeRows = provisionalRows // provisional — fast, may shift on penalties
    provisional = true
  } else if (resultsJson) {
    writeRows = parseResults(resultsJson)
  }

  if (writeRows?.length) {
    const { error: resErr } = await db.from('results').upsert(
      writeRows.map((r) => ({
        race_id: raceId,
        driver_id: r.driverId,
        finish_position: r.finishPosition,
        grid: r.grid,
        status: r.status,
        provisional,
      })),
      { onConflict: 'race_id,driver_id' },
    )
    if (resErr) throw new Error(`results upsert failed: ${resErr.message}`)
  }

  return {
    raceId,
    raced: !!writeRows?.length,
    provisional,
    qualified: !!qualiJson,
    drivers: drivers.length,
  }
}

/** Sync the most recent race on the calendar that has already happened — the one
 *  a scheduler (cron) wants kept fresh so provisional results land at the flag
 *  and the official classification replaces them within the hour, hands-free. */
export async function syncCurrentRound() {
  const db = serverClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await db
    .from('races')
    .select('round')
    .eq('season', CURRENT_SEASON)
    .lte('date', today)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return { skipped: true as const }
  return syncRound(CURRENT_SEASON, data.round)
}
