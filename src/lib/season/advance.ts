import { serverClient } from '@/lib/supabase/server'
import { syncCalendar, syncRound } from '@/lib/f1/sync'
import { computePoolStandings, draftOrderFromStandings } from '@/lib/standings'
import { CURRENT_SEASON } from '@/lib/config'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Daily season autopilot. Idempotent — safe to run repeatedly.
 *
 *  1. Loads the full season calendar so every round exists in `races`.
 *  2. Syncs the current + next race to pull results / qualifying.
 *  3. Auto-completes any race that has finished and has results stored.
 *  4. Opens the next race's draft (auto pick order from standings), gated by the
 *     league's Draft Timing setting:
 *       - 'before' (Pre-Qualifying): open the day after the previous race ends.
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

  const loadRaces = async () => {
    const { data } = await db
      .from('races')
      .select('id,round,name,date,status')
      .eq('season', CURRENT_SEASON)
      .order('round')
    return data ?? []
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

  // The race to draft next: the soonest upcoming round that hasn't happened yet.
  const candidate = races.find(
    (r) => r.status === 'upcoming' && (!r.date || r.date >= today),
  )
  if (!candidate) {
    log.push('no upcoming race to open')
    return { ok: true, opened: null, log }
  }
  // Don't skip ahead of an earlier round that hasn't completed.
  if (races.some((r) => r.round < candidate.round && r.status !== 'complete')) {
    log.push(`R${candidate.round} waiting on an earlier round to finish`)
    return { ok: true, opened: null, log }
  }

  const { data: settings } = await db
    .from('league_settings')
    .select('draft_timing')
    .eq('id', 1)
    .maybeSingle()
  const timing = settings?.draft_timing === 'before' ? 'before' : 'after'

  // Post-Qualifying: hold until this race's qualifying has been synced.
  if (timing === 'after') {
    const { count } = await db
      .from('qualifying')
      .select('*', { count: 'exact', head: true })
      .eq('race_id', candidate.id)
    if ((count ?? 0) === 0) {
      log.push(`R${candidate.round} waiting for qualifying (Post-Qualifying timing)`)
      return { ok: true, opened: null, log }
    }
  }

  // Open the draft with the pick order auto-set from standings (worst-first).
  const { data: players } = await db.from('players').select('id').order('sort_order')
  const ids = (players ?? []).map((p) => p.id)
  const standings = await computePoolStandings(ids)
  const order = draftOrderFromStandings(standings, ids)

  const { error: dErr } = await db
    .from('drafts')
    .upsert(
      { race_id: candidate.id, pick_order: order, status: 'open', rounds: 5 },
      { onConflict: 'race_id' },
    )
  if (dErr) throw new Error(`open draft failed: ${dErr.message}`)
  await db.from('races').update({ status: 'drafting' }).eq('id', candidate.id)
  log.push(`opened draft for R${candidate.round} ${candidate.name}`)

  return { ok: true, opened: candidate.round, log }
}
