import { NextRequest, NextResponse } from 'next/server'
import { syncCalendar } from '@/lib/f1/sync'

// Manual calendar load — triggered by the commissioner's "Load Calendar" button
// on /admin. Pulls the full season schedule from Jolpica and upserts every round
// into `races` so upcoming races appear in the dropdown before they qualify.
export async function POST(req: NextRequest) {
  try {
    const { season } = await req.json()
    const out = await syncCalendar(Number(season))
    return NextResponse.json({ ok: true, ...out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
