import webpush from 'web-push'
import { serverClient } from '@/lib/supabase/server'

let configured = false
function configure() {
  if (configured) return
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@fart-f1.app'
  if (!pub || !priv) throw new Error('VAPID keys not configured')
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * Send a push notification to every registered device of the given players.
 * Dead subscriptions (404/410) are pruned. Never throws — push is best-effort.
 */
export async function sendToPlayers(playerIds: string[], payload: PushPayload) {
  const ids = [...new Set(playerIds)].filter(Boolean)
  if (!ids.length) return { sent: 0, pruned: 0 }
  configure()
  const db = serverClient()

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth')
    .in('player_id', ids)
  if (!subs?.length) return { sent: 0, pruned: 0 }

  const body = JSON.stringify(payload)
  let sent = 0
  const dead: string[] = []

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
        sent++
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode
        if (code === 404 || code === 410) dead.push(s.id)
      }
    }),
  )

  if (dead.length) await db.from('push_subscriptions').delete().in('id', dead)
  return { sent, pruned: dead.length }
}
