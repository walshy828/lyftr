import { Calendar } from 'lucide-react'
import { format } from 'date-fns'
import SegmentedControl from './ui/SegmentedControl'
import DateInput from './ui/DateInput'
import { useStatsControlsContext } from '../context/StatsControlsContext'
import { STATS_PERIODS, STATS_AGGREGATIONS, type StatsPeriod } from '../hooks/useStatsControls'

// Lowercase 'd' matches the pre-existing PeriodSelector text ('7d'/'30d'/'90d'/'All')
// that e2e specs (weight.spec.ts, food.spec.ts) select on with an exact-text match.
const PERIOD_LABELS: Record<StatsPeriod, string> = {
  '1d': '1d', '7d': '7d', '30d': '30d', '90d': '90d', YTD: 'YTD', All: 'All', custom: 'Custom',
}

/**
 * The stats dashboard's global control bar: time period + custom date range +
 * aggregation, shared by every chart in the active panel via StatsControlsContext.
 */
export default function StatsControlBar() {
  const { period, setPeriod, aggregation, setAggregation, customFrom, setCustomFrom, customTo, setCustomTo } = useStatsControlsContext()
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="card p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="overflow-x-auto -mx-1 px-1">
          <SegmentedControl
            options={STATS_PERIODS.map(p => ({ value: p, label: PERIOD_LABELS[p] }))}
            value={period}
            onChange={setPeriod}
            size="sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-tx-muted font-medium hidden sm:inline">View</span>
          <SegmentedControl
            options={STATS_AGGREGATIONS}
            value={aggregation}
            onChange={setAggregation}
            size="sm"
          />
        </div>
      </div>

      {period === 'custom' && (
        <div className="flex items-center gap-2 pt-1 border-t border-surface-border">
          <Calendar className="w-3.5 h-3.5 text-tx-muted flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <DateInput value={customFrom} onChange={setCustomFrom} max={customTo} />
          </div>
          <span className="text-xs text-tx-muted">to</span>
          <div className="flex-1 min-w-0">
            <DateInput value={customTo} onChange={setCustomTo} min={customFrom} max={todayStr} />
          </div>
        </div>
      )}
    </div>
  )
}
