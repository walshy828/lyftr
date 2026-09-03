import { useState } from 'react'
import { format, subDays, startOfYear } from 'date-fns'
import type { Granularity } from '../utils/aggregate'

export const STATS_PERIODS = ['1d', '7d', '30d', '90d', 'YTD', 'All', 'custom'] as const
export type StatsPeriod = typeof STATS_PERIODS[number]

export const STATS_AGGREGATIONS: { value: Granularity; label: string }[] = [
  { value: 'transactional', label: 'Transactional' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const PERIOD_DAYS: Partial<Record<StatsPeriod, number>> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/**
 * The stats dashboard's global period + aggregation controls. `from` is
 * undefined for 'All' — the caller omits the param and asks the server for
 * the whole history — never a fake distant date.
 */
export function useStatsControls() {
  const [period, setPeriod] = useState<StatsPeriod>('30d')
  const [aggregation, setAggregation] = useState<Granularity>('daily')
  const [customFrom, setCustomFrom] = useState<string>(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState<string>(todayStr())

  const to = period === 'custom' ? customTo : todayStr()
  const from = (() => {
    if (period === 'custom') return customFrom
    if (period === 'YTD') return format(startOfYear(new Date()), 'yyyy-MM-dd')
    if (period === 'All') return undefined
    const days = PERIOD_DAYS[period]
    return days != null ? format(subDays(new Date(), days), 'yyyy-MM-dd') : undefined
  })()

  return {
    period, setPeriod,
    aggregation, setAggregation,
    customFrom, setCustomFrom,
    customTo, setCustomTo,
    from, to,
  }
}

export type StatsControls = ReturnType<typeof useStatsControls>
