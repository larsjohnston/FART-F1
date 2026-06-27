import type { DraftState, OnClock } from './types'

export function computeOrder(standings: { playerId: string; points: number }[]): string[] {
  return [...standings].sort((a, b) => b.points - a.points).map(s => s.playerId)
}

export function isComplete(state: DraftState): boolean {
  return state.picks.length >= state.config.order.length * state.config.rounds
}

export function onClock(state: DraftState): OnClock | null {
  if (isComplete(state)) return null
  const n = state.picks.length
  const size = state.config.order.length
  const round0 = Math.floor(n / size)
  const posInRound = n % size
  // Snake drafts reverse the pick order on every other round so the last picker
  // of one round picks first in the next (mitigates first-pick advantage).
  const idx = state.config.snake && round0 % 2 === 1 ? size - 1 - posInRound : posInRound
  return { overall: n + 1, round: round0 + 1, playerId: state.config.order[idx] }
}

export function applyPick(state: DraftState, driverId: string, actorId: string): DraftState {
  const slot = onClock(state)
  if (!slot) throw new Error('draft is complete')
  if (state.picks.some(p => p.driverId === driverId)) throw new Error(`${driverId} already drafted`)
  return { ...state, picks: [...state.picks, { ...slot, driverId, actorId }] }
}
