import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'

// Stores a device's Web Push subscription against the acting player. Called from
// the "Enable notifications" button after the browser grants permission.
export async function POST(req: NextRequest) {
  try {
    const { playerId, subscription } = await req.json()
    const endpoint = subscription?.endpoint
    const p256dh = subscription?.keys?.p256dh
    const auth = subscription?.keys?.auth
    if (!playerId || !endpoint || !p256dh || !auth) {
      return NextResponse.json({ ok: false, error: 'invalid subscription' }, { status: 400 })
    }
    const db = serverClient()
    const { error } = await db
      .from('push_subscriptions')
      .upsert({ player_id: playerId, endpoint, p256dh, auth }, { onConflict: 'endpoint' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
