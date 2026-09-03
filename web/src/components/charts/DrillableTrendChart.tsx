import { useEffect, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import {
  LineChart, BarChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import Loading from '../Loading'
import SegmentedControl from '../ui/SegmentedControl'
import { TOOLTIP_STYLE, AXIS_TICK } from '../../utils/chartTheme'

export interface DrillableColumn<T> {
  key: keyof T
  label: string
  format?: (row: T) => string
}

interface BrushChangeRange {
  startIndex?: number
  endIndex?: number
}

interface Props<T extends Record<string, any>, G = any> {
  /** Chronological (oldest → newest), matching how the chart draws left-to-right. */
  data: T[]
  xKey: keyof T
  columns: DrillableColumn<T>[]
  /** The chart view. Wire a `<Brush dataKey={...} onChange={onBrushChange} />` inside
   *  to enable highlight-to-drill-down; omit it to keep just the chart/table toggle. */
  renderChart: (data: T[], onBrushChange: (range: BrushChangeRange) => void) => ReactNode
  /** Fetches the granular/raw data underlying a highlighted sub-range, keyed by the
   *  same values as `data[i][xKey]` at the drag-selected start/end. */
  granularFetcher?: (from: string, to: string) => Promise<G[]>
  renderGranular?: (rows: G[]) => ReactNode
  emptyMessage?: string
  minPoints?: number
}

/**
 * Shared chart/table toggle + highlight-to-drill-down for dashboard trend charts.
 * Panels own their own Recharts markup (colors, axes, series) via `renderChart`;
 * this component only owns the toggle, the plain-table fallback, and — when a
 * `granularFetcher` is given — resolving a brush-selected sub-range into raw data.
 */
export default function DrillableTrendChart<T extends Record<string, any>, G = any>({
  data, xKey, columns, renderChart, granularFetcher, renderGranular,
  emptyMessage = 'Not enough data yet.', minPoints = 2,
}: Props<T, G>) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [range, setRange] = useState<{ startIndex: number; endIndex: number } | null>(null)
  const [granular, setGranular] = useState<G[] | null>(null)
  const [granularLoading, setGranularLoading] = useState(false)

  const handleBrushChange = (r: BrushChangeRange) => {
    if (r.startIndex == null || r.endIndex == null) return
    // The full range selected is the same as "no selection" — nothing to drill into.
    if (r.startIndex === 0 && r.endIndex === data.length - 1) { setRange(null); return }
    setRange({ startIndex: r.startIndex, endIndex: r.endIndex })
  }

  const fromKey = range ? String(data[range.startIndex]?.[xKey] ?? '') : null
  const toKey = range ? String(data[range.endIndex]?.[xKey] ?? '') : null

  useEffect(() => {
    if (!fromKey || !toKey || !granularFetcher) { setGranular(null); return }
    setGranularLoading(true)
    granularFetcher(fromKey, toKey).then(setGranular).catch(() => setGranular([])).finally(() => setGranularLoading(false))
  }, [fromKey, toKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (data.length < minPoints) {
    return <p className="text-sm text-tx-muted py-6 text-center">{emptyMessage}</p>
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <SegmentedControl
          options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }] as const}
          value={view}
          onChange={setView}
          size="sm"
        />
      </div>

      {view === 'chart' ? (
        renderChart(data, handleBrushChange)
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-tx-muted border-b border-surface-border">
                {columns.map(c => (
                  <th key={String(c.key)} className="py-1.5 pr-4 font-medium whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Newest first, regardless of the chart's chronological order. */}
              {data.slice().reverse().map((row, i) => (
                <tr key={i} className="border-b border-surface-border/40">
                  {columns.map(c => (
                    <td key={String(c.key)} className="py-1.5 pr-4 text-tx-primary tabular-nums whitespace-nowrap">
                      {c.format ? c.format(row) : String(row[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {granularFetcher && renderGranular && range && (
        <div className="mt-3 pt-3 border-t border-surface-border">
          <p className="text-[11px] text-tx-muted mb-2">
            Drilled into {fromKey} – {toKey}
          </p>
          {granularLoading ? <Loading /> : renderGranular(granular ?? [])}
        </div>
      )}
    </div>
  )
}

/** A small raw-sample chart for the granular drill-down view — plots individual
 *  timestamped readings (heart-rate/health-metric samples) rather than a rollup. */
export function RawSeriesChart<T extends Record<string, any>>({
  rows, xKey, yKey, color, unit, chartType = 'line',
}: {
  rows: T[]
  xKey: keyof T
  yKey: keyof T
  color: string
  unit: string
  chartType?: 'line' | 'bar'
}) {
  const points = rows
    .map(r => ({ t: new Date(String(r[xKey])).getTime(), v: Number(r[yKey]) }))
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t)

  if (points.length === 0) {
    return <p className="text-xs text-tx-muted py-4 text-center">No raw samples in this range.</p>
  }

  const Chart: any = chartType === 'bar' ? BarChart : LineChart

  return (
    <ResponsiveContainer width="100%" height={120}>
      <Chart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
        <XAxis
          dataKey="t" type="number" domain={['auto', 'auto']}
          tick={AXIS_TICK} axisLine={false} tickLine={false}
          tickFormatter={(t: number) => format(new Date(t), 'MMM d, h a')}
        />
        <YAxis
          tick={AXIS_TICK} axisLine={false} tickLine={false} width={30}
          domain={chartType === 'bar' ? [0, 'auto'] : ['auto', 'auto']}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelFormatter={(t: number) => format(new Date(t), 'MMM d, h:mm a')}
          formatter={(v: number) => [`${v} ${unit}`, '']}
        />
        {chartType === 'bar'
          ? <Bar dataKey="v" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          : <Line dataKey="v" stroke={color} strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />}
      </Chart>
    </ResponsiveContainer>
  )
}
