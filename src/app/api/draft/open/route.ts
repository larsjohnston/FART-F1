import { NextResponse } from 'next/server'
import { forceOpenDraft } from '@/lib/season/advance'

// Manual "Open draft now" from the commissioner page. Opens the next eligible
// race's draft immediately (bypassing the qualifying / Draft-Floor-day gates)
// and pushes "draft is open" to everyone.
const today = () => new Date().toISOString().slice(0, 10)

export async function POST() {
  try {
    return NextResponse.json(await forceOpenDraft(today()))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
