import { createContext, useContext, type ReactNode } from 'react'
import { useStatsControls, type StatsControls } from '../hooks/useStatsControls'

const StatsControlsContext = createContext<StatsControls | null>(null)

export function StatsControlsProvider({ children }: { children: ReactNode }) {
  const controls = useStatsControls()
  return <StatsControlsContext.Provider value={controls}>{children}</StatsControlsContext.Provider>
}

export function useStatsControlsContext(): StatsControls {
  const ctx = useContext(StatsControlsContext)
  if (!ctx) throw new Error('useStatsControlsContext must be used within a StatsControlsProvider')
  return ctx
}
