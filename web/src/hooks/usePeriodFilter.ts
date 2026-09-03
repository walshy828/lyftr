import { useState } from 'react'
import { format, subDays } from 'date-fns'

export const PERIODS = ['7d', '30d', '90d', 'All'] as const
export type Period = typeof PERIODS[number]

const PERIOD_DAYS: Record<Period, number | null> = { '7d': 7, '30d': 30, '90d': 90, 'All': null }

/**
 * Shared 7d/30d/90d/All period-filter state for dashboard panels. `from` is
 * undefined for 'All' (the caller omits the param, asking the server for the
 * whole history) — never a fake distant date, which would just move the
 * "everything" boundary somewhere arbitrary instead of removing it.
 */
export function usePeriodFilter(defaultPeriod: Period = '30d') {
  const [period, setPeriod] = useState<Period>(defaultPeriod)
  const days = PERIOD_DAYS[period]
  const from = days != null ? format(subDays(new Date(), days), 'yyyy-MM-dd') : undefined
  const to = format(new Date(), 'yyyy-MM-dd')
  return { period, setPeriod, from, to, PERIODS }
}
