import { NextRequest, NextResponse } from 'next/server'
import { syncRound, syncCurrentRound } from '@/lib/f1/sync'

export async function POST(req: NextRequest) {
  try {
    const { season, round } = await req.json()
    const out = await syncRound(Number(season), Number(round))
    return NextResponse.json({ ok: true, ...out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}

// Scheduler entrypoint (Vercel cron / any GET): keep the latest race fresh so
// provisional results land at the flag and the official result replaces them as
// soon as it posts, without anyone pressing Sync. Guarded by CRON_SECRET when
// set (Vercel sends it automatically as a Bearer token).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const out = await syncCurrentRound()
    return NextResponse.json({ ok: true, ...out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
