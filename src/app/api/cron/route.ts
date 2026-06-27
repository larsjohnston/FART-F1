import { NextRequest, NextResponse } from 'next/server'
import { advanceSeason } from '@/lib/season/advance'

// Season autopilot. Two entrypoints:
//   GET  — the once-daily Vercel cron (vercel.json). Protected by CRON_SECRET:
//          Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`.
//   POST — manual "Advance now" trigger from the commissioner page.
// Both run the same idempotent advanceSeason(): load the calendar, sync results
// + qualifying, complete finished races, and open the next race's draft.

const today = () => new Date().toISOString().slice(0, 10)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await advanceSeason(today()))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST() {
  try {
    return NextResponse.json(await advanceSeason(today()))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
