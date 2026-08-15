import { useState, useEffect } from 'react'
import { format, subDays } from 'date-fns'
import { cardioAPI } from '../services/api'
import * as types from '../types'

export interface CardioStatsResult {
  stats: types.CardioStats | null
  loading: boolean
  error: string | null
}

const EMPTY: types.CardioStats = {
  from: '', to: '',
  totals: { sessions: 0, duration: 0, distance_meters: 0, calories: 0, active_days: 0 },
  daily: [], streak: { current: 0, longest: 0 },
}

/**
 * Loads server-computed cardio aggregates for a window, mirroring
 * useTrainingStats. `days` counts back from today inclusive.
 */
export function useCardioStats(
  days = 365,
  include?: ('daily' | 'streak')[],
  combinedStreak = false,
): CardioStatsResult {
  const [stats, setStats] = useState<types.CardioStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const includeKey = include?.join(',') ?? ''

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const to = new Date()
    cardioAPI
      .stats({
        from: format(subDays(to, days - 1), 'yyyy-MM-dd'),
        to: format(to, 'yyyy-MM-dd'),
        include,
        combinedStreak,
      })
      .then(res => {
        if (cancelled) return
        setStats(res)
        setError(null)
      })
      .catch(err => {
        if (cancelled) return
        setStats(EMPTY)
        setError(err?.message || 'Failed to load cardio stats')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, includeKey, combinedStreak])

  return { stats, loading, error }
}
