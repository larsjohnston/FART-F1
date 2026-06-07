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
    const s = localStorage.getItem('actingAs')
    if (s) {
      try { setActingAs(JSON.parse(s)) } catch { /* ignore corrupt storage */ }
    }
  }, [])

  useEffect(() => {
    if (actingAs) localStorage.setItem('actingAs', JSON.stringify(actingAs))
    else localStorage.removeItem('actingAs')
  }, [actingAs])

  return <PlayerCtx.Provider value={{ actingAs, setActingAs }}>{children}</PlayerCtx.Provider>
}

export const usePlayer = () => useContext(PlayerCtx)
