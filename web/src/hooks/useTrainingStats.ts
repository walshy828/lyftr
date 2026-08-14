import { useState, useEffect } from 'react'
import { format, subDays } from 'date-fns'
import { workoutAPI } from '../services/api'
import * as types from '../types'

export interface TrainingStatsResult {
  stats: types.TrainingStats | null
  loading: boolean
  error: string | null
}

const EMPTY: types.TrainingStats = {
  from: '', to: '', weight_unit: 'lbs',
  totals: { workouts: 0, duration: 0, volume: 0, sets: 0, active_days: 0 },
  daily: [], muscles: [], streak: { current: 0, longest: 0 },
}

/**
 * Loads server-computed training aggregates for a window.
 *
 * These used to be reduced on the client over a page of workouts, which quietly
 * made every "all-time" number a function of the page size. The aggregation now
 * happens where all the rows are; this hook just fetches the answer.
 *
 * `days` counts back from today inclusive, so 365 is a full-year heatmap.
 */
export function useTrainingStats(
  days = 365,
  include?: ('daily' | 'muscles' | 'streak')[],
): TrainingStatsResult {
  const [stats, setStats] = useState<types.TrainingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The include list is an array literal at most call sites, so a new identity
  // every render — key the effect on its contents, not the array itself.
  const includeKey = include?.join(',') ?? ''

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const to = new Date()
    workoutAPI
      .stats({
        from: format(subDays(to, days - 1), 'yyyy-MM-dd'),
        to: format(to, 'yyyy-MM-dd'),
        include,
      })
      .then(res => {
        if (cancelled) return
        setStats(res)
        setError(null)
      })
      .catch(err => {
        if (cancelled) return
        // Degrade to zeros rather than blanking the screen: a card reading "no
        // training yet" is wrong but harmless, where a crashed dashboard is not.
        setStats(EMPTY)
        setError(err?.message || 'Failed to load training stats')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, includeKey])

  return { stats, loading, error }
}
