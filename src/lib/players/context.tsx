'use client'
import { createContext, useContext, useEffect, useState } from 'react'

export interface Player {
  id: string
  name: string
  color: string
  is_commissioner: boolean
}

interface Ctx {
  actingAs: Player | null
  setActingAs: (p: Player | null) => void
}

const PlayerCtx = createContext<Ctx>({ actingAs: null, setActingAs: () => {} })

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [actingAs, setActingAs] = useState<Player | null>(null)

  useEffect(() => {
    // Safari (private mode / tracking-prevention) can make localStorage throw,
    // not just return null — guard the access itself, not only JSON.parse.
    try {
      const s = localStorage.getItem('actingAs')
      if (s) setActingAs(JSON.parse(s))
    } catch { /* storage blocked or corrupt — stay logged out */ }
  }, [])

  useEffect(() => {
    try {
      if (actingAs) localStorage.setItem('actingAs', JSON.stringify(actingAs))
      else localStorage.removeItem('actingAs')
    } catch { /* storage blocked — identity persists in memory for this session */ }
  }, [actingAs])

  return <PlayerCtx.Provider value={{ actingAs, setActingAs }}>{children}</PlayerCtx.Provider>
}

export const usePlayer = () => useContext(PlayerCtx)
