export interface DraftConfig { order: string[]; rounds: number }   // order = player ids, worst-first
export interface Pick { overall: number; round: number; playerId: string; driverId: string; actorId: string }
export interface DraftState { config: DraftConfig; picks: Pick[] }
export interface OnClock { overall: number; round: number; playerId: string }
