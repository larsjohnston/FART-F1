import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { onClock } from '@/lib/draft/engine'
import { sendToPlayers } from '@/lib/push/server'
import { generateCommentary } from '@/lib/commentary/generate'
import type { DraftState } from '@/lib/draft/types'

// Fired by the picking client right after a pick lands. Recomputes the draft
// state from the DB (authoritative) and:
//   - generates a sarcastic one-line commentary for the pick (stored for the
//     live feed; also used as the "a pick was made" push body)
//   - sends "you're on the clock" to the player now up
//   - sends the commentary to every other player (except the picker)
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
      .from('drivers').select('family_name,constructor_id').eq('id', last.driverId).maybeSingle()
    const driverName = driver?.family_name ?? 'a driver'
    const pickerName = nameById[last.actorId] ?? 'Someone'

    // Extra colour for the roast: team name + this race's qualifying spot.
    const { data: cons } = driver?.constructor_id
      ? await db.from('constructors').select('name').eq('id', driver.constructor_id).maybeSingle()
      : { data: null }
    const { data: quali } = await db
      .from('qualifying').select('position').eq('race_id', raceId).eq('driver_id', last.driverId).maybeSingle()

    // Sarcastic commentary (best-effort — null if no API key / failure).
    const size = state.config.order.length
    const quip = await generateCommentary({
      picker: pickerName,
      driver: driverName,
      team: cons?.name ?? null,
      grid: quali?.position ?? null,
      round: last.round,
      overall: last.overall,
      pickInRound: ((last.overall - 1) % size) + 1,
      playerCount: size,
      raceName,
    })
    if (quip) {
      await db.from('commentary').upsert(
        { draft_id: draft.id, overall: last.overall, text: quip },
        { onConflict: 'draft_id,overall' },
      )
    }

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
    // The commentary is the body when we have it; otherwise a plain fallback.
    const others = (players ?? [])
      .map((p) => p.id)
      .filter((id) => id !== last.actorId && id !== slot?.playerId)
    await sendToPlayers(others, {
      title: `${pickerName} picked ${driverName}`,
      body: quip
        ? quip
        : slot
          ? `${nameById[slot.playerId] ?? 'Someone'} is up next.`
          : `That's a wrap — the ${raceName} draft is complete.`,
      url: '/draft',
      tag: 'fart-f1-pick',
    })

    return NextResponse.json({ ok: true, onClock: slot?.playerId ?? null, commentary: quip })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
