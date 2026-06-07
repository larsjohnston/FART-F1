import { NextRequest, NextResponse } from 'next/server'
import { syncRound } from '@/lib/f1/sync'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { season, round } = body
  try {
    const out = await syncRound(Number(season), Number(round))
    return NextResponse.json({ ok: true, ...out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
