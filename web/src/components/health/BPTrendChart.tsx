import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import DrillableTrendChart, { ChartTableToggle } from '../charts/DrillableTrendChart'
import { aggregateByPeriod, type Granularity } from '../../utils/aggregate'
import {
  TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE,
  BP_SYS_COLOR, BP_DIA_COLOR, BP_ZONE_COLORS,
} from '../../utils/chartTheme'
import type { BPDay } from '../../types'

interface Props {
  days: BPDay[]
  from?: string
  to?: string
  aggregation: Granularity
}

/** Band edges on the systolic scale, matching utils/bloodpressure.go. */
const BANDS: { from: number; to: number; color: string }[] = [
  { from: 0, to: 120, color: BP_ZONE_COLORS.normal },
  { from: 120, to: 130, color: BP_ZONE_COLORS.elevated },
  { from: 130, to: 140, color: BP_ZONE_COLORS.stage1 },
  { from: 140, to: 999, color: BP_ZONE_COLORS.stage2 },
]

export default function BPTrendChart({ days, from, to, aggregation }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart')

  const data = useMemo(() => {
    const filtered = days.filter(d => (from == null || d.day >= from) && (to == null || d.day <= to))
    const points = filtered.map(d => ({ day: d.day, systolic: d.systolic, diastolic: d.diastolic }))
    return aggregateByPeriod(points, 'day', aggregation, [
      { key: 'systolic', agg: 'avg' },
      { key: 'diastolic', agg: 'avg' },
    ]).map(p => ({ day: p.day, systolic: Math.round(p.systolic ?? 0), diastolic: Math.round(p.diastolic ?? 0) }))
  }, [days, from, to, aggregation])

  // Pad the domain around the actual data rather than fixing it. A fixed 60-180
  // axis would render a healthy user's whole chart inside one green band and
  // flatten every real movement out of visibility.
  const [yMin, yMax] = useMemo(() => {
    if (!data.length) return [60, 160]
    const lows = data.map(d => d.diastolic)
    const highs = data.map(d => d.systolic)
    return [
      Math.max(40, Math.floor((Math.min(...lows) - 8) / 10) * 10),
      Math.ceil((Math.max(...highs) + 8) / 10) * 10,
    ]
  }, [data])

  return (
    <div>
      <div className="flex justify-end mb-2">
        <ChartTableToggle view={view} onChange={setView} />
      </div>
      <DrillableTrendChart
        data={data}
        xKey="day"
        view={view}
        onViewChange={setView}
        hideToggle
        emptyMessage="Two days of readings will draw your trend."
        columns={[
          { key: 'day', label: 'Date', format: r => { try { return format(parseISO(r.day), 'MMM d, yyyy') } catch { return r.day } } },
          { key: 'systolic', label: 'Systolic', format: r => `${r.systolic} mmHg` },
          { key: 'diastolic', label: 'Diastolic', format: r => `${r.diastolic} mmHg` },
        ]}
        renderChart={chartData => (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                {/* Only bands that intersect the visible domain get drawn. */}
                {BANDS.filter(b => b.to > yMin && b.from < yMax).map(b => (
                  <ReferenceArea
                    key={b.from}
                    y1={Math.max(b.from, yMin)}
                    y2={Math.min(b.to, yMax)}
                    fill={b.color}
                    fillOpacity={0.07}
                    strokeOpacity={0}
                  />
                ))}
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={(d: string) => format(parseISO(d), 'MMM d')}
                />
                <YAxis
                  domain={[yMin, yMax]}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d: string) => format(parseISO(d), 'EEE, MMM d')}
                  formatter={(v: number, name: string) => [`${v} mmHg`, name]}
                />
                <Line
                  dataKey="systolic" name="Systolic" type="monotone"
                  stroke={BP_SYS_COLOR} strokeWidth={2} dot={false}
                  isAnimationActive={false} connectNulls
                />
                <Line
                  dataKey="diastolic" name="Diastolic" type="monotone"
                  stroke={BP_DIA_COLOR} strokeWidth={2} dot={false}
                  isAnimationActive={false} connectNulls
                />
              </LineChart>
            </ResponsiveContainer>

            <div className="flex items-center justify-center gap-4 mt-1">
              <span className="flex items-center gap-1.5 text-[11px] text-tx-muted">
                <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: BP_SYS_COLOR }} />
                Systolic
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-tx-muted">
                <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: BP_DIA_COLOR }} />
                Diastolic
              </span>
            </div>
            <p className="text-[11px] text-tx-muted text-center mt-1">
              Daily averages — the same basis your category is calculated from.
            </p>
          </>
        )}
      />
    </div>
  )
}
