'use client'
import { supabase } from '@/lib/supabase/client'
import { SUPABASE_SCHEMA } from '@/lib/config'
import { applyPick, onClock } from './engine'
import type { DraftState } from './types'

export interface DraftRow {
  id: string
  race_id: string
  status: string
  pick_order: string[]
  rounds: number
  snake: boolean
}

export async function loadDraft(raceId: string): Promise<{ draft: DraftRow; state: DraftState } | null> {
  const { data: draft, error: dErr } = await supabase
    .from('drafts')
    .select('*')
    .eq('race_id', raceId)
    .maybeSingle()
  if (dErr) throw dErr
  if (!draft) return null
  const { data: picks, error: pErr } = await supabase
    .from('picks')
    .select('*')
    .eq('draft_id', draft.id)
    .order('overall')
  if (pErr) throw pErr
  const state: DraftState = {
    config: { order: draft.pick_order, rounds: draft.rounds, snake: draft.snake ?? false },
    picks: (picks ?? []).map(p => ({
      overall: p.overall,
      round: p.round,
      playerId: p.player_id,
      driverId: p.driver_id,
      actorId: p.actor_id,
    })),
  }
  return { draft, state }
}

/** Validate with the pure engine, then persist the new pick. Realtime broadcasts the insert. */
export async function makePick(draft: DraftRow, state: DraftState, driverId: string, actorId: string) {
  const next = applyPick(state, driverId, actorId) // throws on illegal pick
  const p = next.picks[next.picks.length - 1]
  const { error } = await supabase.from('picks').insert({
    draft_id: draft.id,
    overall: p.overall,
    round: p.round,
    player_id: p.playerId,
    actor_id: p.actorId,
    driver_id: p.driverId,
  })
  if (error) throw error
  if (onClock(next) === null) {
    await supabase.from('drafts').update({ status: 'complete' }).eq('id', draft.id)
  }
}

export function subscribePicks(draftId: string, onChange: () => void) {
  const ch = supabase
    .channel(`draft-${draftId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: SUPABASE_SCHEMA, table: 'picks', filter: `draft_id=eq.${draftId}` },
      onChange,
    )
    .subscribe()
  return () => {
    supabase.removeChannel(ch)
  }
}

export interface CommentaryRow { overall: number; text: string }

/** Load all sarcastic commentary lines for a draft, in pick order. */
export async function loadCommentary(draftId: string): Promise<CommentaryRow[]> {
  const { data } = await supabase
    .from('commentary')
    .select('overall,text')
    .eq('draft_id', draftId)
    .order('overall')
  return data ?? []
}

/** Subscribe to live commentary inserts for a draft. */
export function subscribeCommentary(draftId: string, onChange: () => void) {
  const ch = supabase
    .channel(`commentary-${draftId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: SUPABASE_SCHEMA, table: 'commentary', filter: `draft_id=eq.${draftId}` },
      onChange,
    )
    .subscribe()
  return () => {
    supabase.removeChannel(ch)
  }
}

export async function undoLastPick(draftId: string) {
  const { data } = await supabase
    .from('picks')
    .select('id,overall')
    .eq('draft_id', draftId)
    .order('overall', { ascending: false })
    .limit(1)
  if (data?.[0]) {
    await supabase.from('picks').delete().eq('id', data[0].id)
    await supabase.from('drafts').update({ status: 'open' }).eq('id', draftId)
  }
}
