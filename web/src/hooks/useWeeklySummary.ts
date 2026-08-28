import { useState, useEffect } from 'react'
import { format, subDays } from 'date-fns'
import { workoutAPI, cardioAPI, foodAPI, weightAPI, weightPlanAPI } from '../services/api'
import { weeksBack, buildWeeklySummary, type WeeklySummaryRow } from '../utils/weeklySummary'
import type { WeightPlanHistoryWeek } from '../types'

export interface WeeklySummaryResult {
  rows: WeeklySummaryRow[]
  loading: boolean
  error: string | null
  hasPlan: boolean
}

// Extra lookback so the first week in the window can carry forward a
// starting weight from before it, instead of reading as "no data" just
// because nobody weighed in on day one of the window.
const WEIGHT_LOOKBACK_DAYS = 14

/**
 * Loads and buckets every source series (training, cardio, nutrition,
 * weight, plan) into `weeks` consecutive Mon-start weeks ending today.
 *
 * Follows useTrainingStats's shape: degrade to an empty result on error
 * rather than blanking the page, except the plan fetch, whose 404 (no
 * active weight-loss plan) is expected and just means `hasPlan: false`.
 */
export function useWeeklySummary(weeks: number, proteinTarget: number): WeeklySummaryResult {
  const [rows, setRows] = useState<WeeklySummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasPlan, setHasPlan] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const now = new Date()
    const ranges = weeksBack(now, weeks)
    const from = format(ranges[0].start, 'yyyy-MM-dd')
    const to = format(now, 'yyyy-MM-dd')
    const weightFrom = format(subDays(ranges[0].start, WEIGHT_LOOKBACK_DAYS), 'yyyy-MM-dd')

    Promise.all([
      workoutAPI.stats({ from, to, include: ['daily'] }),
      cardioAPI.stats({ from, to, include: ['daily'] }),
      foodAPI.history(weeks * 7),
      weightAPI.list({ from: weightFrom, to, limit: 1000 }),
      weightPlanAPI.progress().catch(err => {
        if (err?.response?.status === 404) return null
        throw err
      }),
    ])
      .then(([training, cardio, foodHistory, weightLogs, planHistory]) => {
        if (cancelled) return
        const planWeeks: WeightPlanHistoryWeek[] | undefined = planHistory?.weeks
        setRows(buildWeeklySummary(
          ranges, training.daily ?? [], cardio.daily ?? [], foodHistory ?? [], weightLogs ?? [],
          proteinTarget, now, planWeeks,
        ))
        setHasPlan(!!planWeeks?.length)
        setError(null)
      })
      .catch(err => {
        if (cancelled) return
        setRows([])
        setHasPlan(false)
        setError(err?.message || 'Failed to load weekly summary')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, proteinTarget])

  return { rows, loading, error, hasPlan }
}
