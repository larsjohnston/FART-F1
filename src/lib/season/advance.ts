import { serverClient } from '@/lib/supabase/server'
import { syncCalendar, syncRound } from '@/lib/f1/sync'
import { computeDraftOrder } from '@/lib/standings'
import { sendToPlayers } from '@/lib/push/server'
import { CURRENT_SEASON } from '@/lib/config'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const cityOf = (name: string) => name.replace(/\s+Grand Prix$/i, '')

interface Race { id: string; round: number; name: string; date: string | null; status: string }
interface Settings {
  timing: 'before' | 'after'
  rounds: number
  snake: boolean
  basis: 'overall' | 'weekly'
  openDay: number // 1=Mon … 6=Sat, for 'before' timing
}

function readSettings(raw: Record<string, unknown> | null): Settings {
  return {
    timing: raw?.draft_timing === 'before' ? 'before' : 'after',
    rounds: Number(raw?.drivers_per_week ?? 5) || 5,
    snake: raw?.draft_order_type === 'snake',
    basis: raw?.draft_order_basis === 'weekly' ? 'weekly' : 'overall',
    openDay: Math.min(6, Math.max(1, Number(raw?.draft_open_day ?? 1) || 1)),
  }
}

async function loadSettings(db: ReturnType<typeof serverClient>): Promise<Settings> {
  const { data } = await db
    .from('league_settings')
    .select('draft_timing,drivers_per_week,draft_order_type,draft_order_basis,draft_open_day')
    .eq('id', 1)
    .maybeSingle()
  return readSettings(data)
}

/**
 * For a 'before' (pre-qualifying) draft, the date the Draft Floor opens: the
 * configured weekday (1=Mon … 6=Sat) within the race's own week, on or before
 * race day. e.g. a Sunday race with openDay=Mon opens the Monday six days prior.
 */
function openDateForRaceWeek(raceDate: string, weekday: number): string {
  const d = new Date(`${raceDate}T00:00:00Z`)
  const back = (d.getUTCDay() - weekday + 7) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/**
 * The next race that should be drafted: the soonest upcoming round that hasn't
 * happened, provided no earlier round is still incomplete. Returns a reason
 * string instead when nothing is eligible.
 */
function nextDraftCandidate(races: Race[], today: string): { candidate: Race | null; reason: string } {
  const candidate = races.find((r) => r.status === 'upcoming' && (!r.date || r.date >= today))
  if (!candidate) return { candidate: null, reason: 'no upcoming race to open' }
  if (races.some((r) => r.round < candidate.round && r.status !== 'complete')) {
    return { candidate: null, reason: `R${candidate.round} waiting on an earlier round to finish` }
  }
  return { candidate, reason: '' }
}

/**
 * Open the draft for a race: pick order from the configured basis (worst-first),
 * mark the race 'drafting', and push "draft is open — {first picker} up first"
 * to every player. Push is best-effort and never blocks the open.
 */
async function openDraftFor(
  db: ReturnType<typeof serverClient>,
  race: Race,
  settings: Settings,
): Promise<{ firstPicker: string }> {
  const { data: players } = await db.from('players').select('id,name').order('sort_order')
  const ids = (players ?? []).map((p) => p.id)
  const order = await computeDraftOrder(ids, settings.basis)

  const { error: dErr } = await db
    .from('drafts')
    .upsert(
      { race_id: race.id, pick_order: order, status: 'open', rounds: settings.rounds, snake: settings.snake },
      { onConflict: 'race_id' },
    )
  if (dErr) throw new Error(`open draft failed: ${dErr.message}`)
  await db.from('races').update({ status: 'drafting' }).eq('id', race.id)

  const nameById = Object.fromEntries((players ?? []).map((p) => [p.id, p.name]))
  const firstPicker = nameById[order[0]] ?? 'Someone'
  const city = cityOf(race.name)
  try {
    await sendToPlayers(ids, {
      title: `🏁 ${city} draft is open`,
      body: `${firstPicker} picks first — get your ${settings.rounds} in.`,
      url: '/draft',
      tag: 'fart-f1-draft-open',
    })
  } catch {
    /* push not configured / failed — opening still succeeds */
  }
  return { firstPicker }
}

/**
 * Daily season autopilot. Idempotent — safe to run repeatedly.
 *
 *  1. Loads the full season calendar so every round exists in `races`.
 *  2. Syncs the current + next race to pull results / qualifying.
 *  3. Auto-completes any race that has finished and has results stored.
 *  4. Opens the next race's draft (auto pick order from standings + a push to
 *     everyone), gated by the league's Draft Timing setting:
 *       - 'before' (Pre-Qualifying): open on the configured Draft Floor weekday.
 *       - 'after'  (Post-Qualifying): open once that race's qualifying is synced.
 *
 * Only one draft is ever open at a time, and a race already 'drafting' or
 * 'complete' is never reopened.
 */
export async function advanceSeason(today: string) {
  const db = serverClient()
  const log: string[] = []

  // 1 — make sure the whole calendar is present.
  try {
    const cal = await syncCalendar(CURRENT_SEASON)
    log.push(`calendar: ${cal.rounds} races on the ${CURRENT_SEASON} schedule`)
  } catch (e) {
    log.push(`calendar load skipped: ${errMsg(e)}`)
  }

  const loadRaces = async (): Promise<Race[]> => {
    const { data } = await db
      .from('races')
      .select('id,round,name,date,status')
      .eq('season', CURRENT_SEASON)
      .order('round')
    return (data ?? []) as Race[]
  }

  let races = await loadRaces()
  if (!races.length) {
    log.push('no races for the season yet')
    return { ok: true, opened: null, log }
  }

  // 2 — sync the current race (latest already started) and the next race so
  //     results and qualifying are fresh before we decide what to do.
  const past = races.filter((r) => r.date && r.date <= today)
  const current = past.length ? past[past.length - 1] : null
  const next = races.find((r) => r.date && r.date > today) ?? null
  for (const r of [current, next]) {
    if (!r) continue
    try {
      await syncRound(CURRENT_SEASON, r.round)
      log.push(`synced R${r.round} ${r.name}`)
    } catch (e) {
      log.push(`sync R${r.round} skipped: ${errMsg(e)}`)
    }
  }
  races = await loadRaces() // re-read: statuses/dates may have changed

  // 3 — auto-complete any finished race that has results but isn't complete yet.
  for (const r of races) {
    if (r.status === 'complete' || !r.date || r.date > today) continue
    const { count } = await db
      .from('results')
      .select('*', { count: 'exact', head: true })
      .eq('race_id', r.id)
    if ((count ?? 0) > 0) {
      await db.from('races').update({ status: 'complete' }).eq('id', r.id)
      r.status = 'complete'
      log.push(`completed R${r.round} ${r.name}`)
    }
  }

  // 4 — advance to the next race. Never run two drafts at once.
  const openRace = races.find((r) => r.status === 'drafting')
  if (openRace) {
    log.push(`a draft is already open (R${openRace.round} ${openRace.name}) — leaving it be`)
    return { ok: true, opened: null, drafting: openRace.round, log }
  }

  const { candidate, reason } = nextDraftCandidate(races, today)
  if (!candidate) {
    log.push(reason)
    return { ok: true, opened: null, log }
  }

  const settings = await loadSettings(db)

  if (settings.timing === 'after') {
    // Post-Qualifying: hold until this race's qualifying has been synced.
    const { count } = await db
      .from('qualifying')
      .select('*', { count: 'exact', head: true })
      .eq('race_id', candidate.id)
    if ((count ?? 0) === 0) {
      log.push(`R${candidate.round} waiting for qualifying (Post-Qualifying timing)`)
      return { ok: true, opened: null, log }
    }
  } else if (candidate.date) {
    // Pre-Qualifying: hold until the configured Draft Floor weekday.
    const openOn = openDateForRaceWeek(candidate.date, settings.openDay)
    if (today < openOn) {
      log.push(`R${candidate.round} opens ${openOn} (Draft Floor day)`)
      return { ok: true, opened: null, log }
    }
  }

  const { firstPicker } = await openDraftFor(db, candidate, settings)
  log.push(`opened draft for R${candidate.round} ${candidate.name} — ${firstPicker} first`)
  return { ok: true, opened: candidate.round, log }
}

/**
 * Manual "Open draft now" — opens the next eligible race's draft immediately,
 * bypassing the qualifying / Draft-Floor-day gates (but never two at once, and
 * never skipping ahead of an unfinished earlier round). Sends the same push.
 */
export async function forceOpenDraft(today: string) {
  const db = serverClient()
  try {
    await syncCalendar(CURRENT_SEASON)
  } catch {
    /* best-effort — fall back to whatever races already exist */
  }
  const { data } = await db
    .from('races')
    .select('id,round,name,date,status')
    .eq('season', CURRENT_SEASON)
    .order('round')
  const races = (data ?? []) as Race[]

  const openRace = races.find((r) => r.status === 'drafting')
  if (openRace) {
    return { ok: true, opened: null, race: cityOf(openRace.name), message: `A draft is already open for ${cityOf(openRace.name)}.` }
  }

  const { candidate, reason } = nextDraftCandidate(races, today)
  if (!candidate) {
    return { ok: true, opened: null, race: null, message: reason }
  }

  const settings = await loadSettings(db)
  const { firstPicker } = await openDraftFor(db, candidate, settings)
  return {
    ok: true,
    opened: candidate.round,
    race: cityOf(candidate.name),
    firstPicker,
    message: `Opened the ${cityOf(candidate.name)} draft — ${firstPicker} picks first.`,
  }
}
