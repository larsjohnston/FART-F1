import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { onClock } from '@/lib/draft/engine'
import { sendToPlayers } from '@/lib/push/server'
import type { DraftState } from '@/lib/draft/types'

// Fired by the picking client right after a pick lands. Recomputes the draft
// state from the DB (authoritative) and sends:
//   - "you're on the clock" to the player now up
//   - "a pick was made" to every other player (except the one who just picked
//     and the on-clock player, who already got the more specific alert)
export async function POST(req: NextRequest) {
  try {
    const { raceId } = await req.json()
    if (!raceId) return NextResponse.json({ ok: false, error: 'raceId required' }, { status: 400 })
    const db = serverClient()

    const { data: race } = await db.from('races').select('id,name').eq('id', raceId).maybeSingle()
    const { data: draft } = await db.from('drafts').select('*').eq('race_id', raceId).maybeSingle()
    if (!draft) return NextResponse.json({ ok: true, skipped: 'no draft' })

    const { data: picks } = await db
      .from('picks').select('*').eq('draft_id', draft.id).order('overall')
    if (!picks?.length) return NextResponse.json({ ok: true, skipped: 'no picks' })

    const state: DraftState = {
      config: { order: draft.pick_order, rounds: draft.rounds },
      picks: picks.map((p) => ({
        overall: p.overall, round: p.round,
        playerId: p.player_id, driverId: p.driver_id, actorId: p.actor_id,
      })),
    }

    const last = state.picks[state.picks.length - 1]
    const slot = onClock(state)
    const raceName = (race?.name ?? 'the race').replace(/\s+Grand Prix$/i, ' GP')

    const { data: players } = await db.from('players').select('id,name')
    const nameById = Object.fromEntries((players ?? []).map((p) => [p.id, p.name]))
    const { data: driver } = await db
      .from('drivers').select('family_name').eq('id', last.driverId).maybeSingle()
    const driverName = driver?.family_name ?? 'a driver'
    const pickerName = nameById[last.actorId] ?? 'Someone'

    // "Your turn" to the on-clock player.
    if (slot) {
      await sendToPlayers([slot.playerId], {
        title: "🏁 You're on the clock",
        body: `Your pick is up for the ${raceName}.`,
        url: '/draft',
        tag: 'fart-f1-turn',
      })
    }

    // "A pick was made" to everyone else (not the picker, not the on-clock player).
    const others = (players ?? [])
      .map((p) => p.id)
      .filter((id) => id !== last.actorId && id !== slot?.playerId)
    await sendToPlayers(others, {
      title: `${pickerName} picked ${driverName}`,
      body: slot
        ? `${nameById[slot.playerId] ?? 'Someone'} is up next.`
        : `That's a wrap — the ${raceName} draft is complete.`,
      url: '/draft',
      tag: 'fart-f1-pick',
    })

    return NextResponse.json({ ok: true, onClock: slot?.playerId ?? null })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
