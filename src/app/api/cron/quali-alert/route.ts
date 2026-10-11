import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { sendToPlayers } from '@/lib/push/server'
import { CURRENT_SEASON } from '@/lib/config'

const cityOf = (name: string) => name.replace(/\s+Grand Prix$/i, '')

// Frequent (every ~15 min, vercel.json) companion to the once-daily /api/cron
// autopilot: fires a "qualifying is starting" push the moment the real session
// time passes, so players get a heads-up before the draft board opens. Fully
// idempotent — races.quali_notified_at is set right after a successful send,
// so each race only ever fires once regardless of how often this runs.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const db = serverClient()
    const { data: race } = await db
      .from('races')
      .select('id,round,name')
      .eq('season', CURRENT_SEASON)
      .not('quali_starts_at', 'is', null)
      .lte('quali_starts_at', new Date().toISOString())
      .is('quali_notified_at', null)
      .order('round')
      .limit(1)
      .maybeSingle()

    if (!race) return NextResponse.json({ ok: true, notified: false })

    const { data: players } = await db.from('players').select('id')
    const ids = (players ?? []).map((p) => p.id)
    const result = await sendToPlayers(ids, {
      title: `🏁 ${cityOf(race.name)} qualifying is starting`,
      body: `Grab a seat — the draft board opens once it's synced.`,
      url: '/draft',
      tag: 'fart-f1-quali-start',
    })
    await db.from('races').update({ quali_notified_at: new Date().toISOString() }).eq('id', race.id)

    return NextResponse.json({ ok: true, notified: true, race: race.name, ...result })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
