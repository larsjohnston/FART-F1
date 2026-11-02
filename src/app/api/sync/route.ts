import { NextRequest, NextResponse } from 'next/server'
import { syncRound } from '@/lib/f1/sync'
import { serverClient } from '@/lib/supabase/server'

// Manual sync — triggered by the commissioner's "Update race results" button
// on /admin (the automatic cron's own re-sync already skips a 'complete'
// race — see advanceSeason). A race already marked 'complete' may carry a
// manual correction (e.g. a post-race penalty Jolpica hadn't reflected yet —
// confirmed live for round 19, twice), and Jolpica can keep serving that
// same stale data for a long stretch, so a plain re-sync here would silently
// clobber the correction right back to wrong. Require an explicit
// {force: true} to resync an already-complete race; otherwise report that
// back without touching anything so the UI can confirm first.
export async function POST(req: NextRequest) {
  try {
    const { season, round, force } = await req.json()
    if (!force) {
      const db = serverClient()
      const { data: race } = await db
        .from('races').select('status').eq('season', Number(season)).eq('round', Number(round)).maybeSingle()
      if (race?.status === 'complete') {
        return NextResponse.json({ ok: true, alreadyComplete: true })
      }
    }
    const out = await syncRound(Number(season), Number(round))
    return NextResponse.json({ ok: true, ...out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
