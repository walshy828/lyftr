import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import {
  TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE,
  BP_SYS_COLOR, BP_DIA_COLOR, BP_ZONE_COLORS,
} from '../../utils/chartTheme'
import type { BPDay } from '../../types'

interface Props {
  days: BPDay[]
}

/** Band edges on the systolic scale, matching utils/bloodpressure.go. */
const BANDS: { from: number; to: number; color: string }[] = [
  { from: 0, to: 120, color: BP_ZONE_COLORS.normal },
  { from: 120, to: 130, color: BP_ZONE_COLORS.elevated },
  { from: 130, to: 140, color: BP_ZONE_COLORS.stage1 },
  { from: 140, to: 999, color: BP_ZONE_COLORS.stage2 },
]

export default function BPTrendChart({ days }: Props) {
  const data = useMemo(
    () => days.map(d => ({
      day: d.day,
      systolic: Math.round(d.systolic),
      diastolic: Math.round(d.diastolic),
    })),
    [days],
  )

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

  if (data.length < 2) {
    return (
      <p className="text-sm text-tx-muted py-6 text-center">
        Two days of readings will draw your trend.
      </p>
    )
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
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
  )
}
