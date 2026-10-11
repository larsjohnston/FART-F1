import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { sendToPlayers } from '@/lib/push/server'
import { CURRENT_SEASON } from '@/lib/config'
import { advanceSeason } from '@/lib/season/advance'

const cityOf = (name: string) => name.replace(/\s+Grand Prix$/i, '')
const today = () => new Date().toISOString().slice(0, 10)
const DAY_MS = 24 * 60 * 60 * 1000

// Frequent (every ~15 min, vercel.json) companion to the once-daily /api/cron
// autopilot. Three jobs, in order:
//   1. "Race weekend starts tomorrow" — ~24h before quali_starts_at.
//   2. "Qualifying is starting" — the moment quali_starts_at passes.
//   3. advanceSeason() — the same idempotent sync/complete/open-draft routine
//      the daily cron runs, so once qualifying data actually lands, the
//      draft opens (and its "draft is open" push fires) within ~15 minutes
//      instead of waiting up to a day.
// All three are keyed off columns set right after a successful send/run, so
// each fires at most once per race regardless of how often this runs.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const db = serverClient()
    const now = new Date()

    const { data: tomorrowRace } = await db
      .from('races')
      .select('id,round,name,quali_starts_at')
      .eq('season', CURRENT_SEASON)
      .not('quali_starts_at', 'is', null)
      .lte('quali_starts_at', new Date(now.getTime() + DAY_MS).toISOString())
      .gt('quali_starts_at', now.toISOString())
      .is('race_tomorrow_notified_at', null)
      .order('round')
      .limit(1)
      .maybeSingle()

    let tomorrowNotified = false
    if (tomorrowRace) {
      const { data: players } = await db.from('players').select('id')
      const ids = (players ?? []).map((p) => p.id)
      await sendToPlayers(ids, {
        title: `📅 ${cityOf(tomorrowRace.name)} weekend starts tomorrow`,
        body: `Qualifying is tomorrow — the draft board follows once it's synced.`,
        url: '/draft',
        tag: 'fart-f1-race-tomorrow',
      })
      await db
        .from('races')
        .update({ race_tomorrow_notified_at: now.toISOString() })
        .eq('id', tomorrowRace.id)
      tomorrowNotified = true
    }

    const { data: qualiRace } = await db
      .from('races')
      .select('id,round,name')
      .eq('season', CURRENT_SEASON)
      .not('quali_starts_at', 'is', null)
      .lte('quali_starts_at', now.toISOString())
      .is('quali_notified_at', null)
      .order('round')
      .limit(1)
      .maybeSingle()

    let qualiNotified = false
    if (qualiRace) {
      const { data: players } = await db.from('players').select('id')
      const ids = (players ?? []).map((p) => p.id)
      await sendToPlayers(ids, {
        title: `🏁 ${cityOf(qualiRace.name)} qualifying is starting`,
        body: `Grab a seat — the draft board opens once it's synced.`,
        url: '/draft',
        tag: 'fart-f1-quali-start',
      })
      await db.from('races').update({ quali_notified_at: now.toISOString() }).eq('id', qualiRace.id)
      qualiNotified = true
    }

    const advance = await advanceSeason(today())

    return NextResponse.json({ ok: true, tomorrowNotified, qualiNotified, advance })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
