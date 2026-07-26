import { useState } from 'react'
import { TrendingUp, Dumbbell } from 'lucide-react'
import {
  format, subDays, startOfDay, startOfWeek, eachDayOfInterval, eachWeekOfInterval,
} from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { SectionHeader } from '../ui'
import PeriodSelector from '../PeriodSelector'
import * as types from '../../types'
import { activityMix, delta } from '../../utils/dashboardMetrics'
import {
  ACTIVITY_HEX, ACTIVITY_ORDER, CARDIO_HEX, AXIS_TICK, type ActivityCategory,
} from '../../utils/chartTheme'

const NOW = new Date()

// Minutes → "3h 45m" / "40m" / "2h". Drops a zero-minute tail.
function fmtDuration(mins: number): string {
  const m = Math.round(mins)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

interface Bucket {
  label: string
  range: string
  sessions: number
  total: number
  // one numeric key per activity category (0 when untrained)
  Cardio: number
  Upper: number
  Lower: number
  Core: number
  'Full Body': number
}

// Custom tooltip: only the categories present in the hovered bucket, plus the
// session count — keeps identity in text, never color-alone.
function TrendTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload?: Bucket }[]
}) {
  const b = active ? payload?.[0]?.payload : undefined
  if (!b || b.total <= 0) return null
  return (
    <div className="bg-surface-raised border border-surface-border rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-tx-primary mb-1">{b.range}</p>
      <div className="space-y-0.5">
        {ACTIVITY_ORDER.filter(c => b[c] > 0).map(c => (
          <div key={c} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ACTIVITY_HEX[c] }} />
            <span className="text-tx-secondary">{c}</span>
            <span className="ml-auto pl-3 tabular-nums text-tx-primary">{fmtDuration(b[c])}</span>
          </div>
        ))}
      </div>
      <p className="text-tx-muted mt-1 pt-1 border-t border-surface-border">
        {fmtDuration(b.total)} · {b.sessions} session{b.sessions === 1 ? '' : 's'}
      </p>
    </div>
  )
}

// "How is my training trending, and what am I working on?" A stacked column of
// time spent per period bucket — cardio vs each strength focus — so the mix,
// the focus areas, and the trend are all readable at a glance.
export default function TrainingTrendsCard({ workouts }: { workouts: types.Workout[] }) {
  const [period, setPeriod] = useState<'7' | '14' | '30' | '90'>('30')
  const days = Number(period)
  const daily = days <= 14

  const windowStart = startOfDay(subDays(NOW, days - 1))
  const inWindow = workouts.filter(w => new Date(w.started_at) >= windowStart)

  // Bucket boundaries covering the whole window as half-open [start, next)
  // ranges, so quiet stretches read as gaps rather than being collapsed away.
  const buckets: Bucket[] = daily
    ? eachDayOfInterval({ start: windowStart, end: NOW }).map(day => {
        const start = startOfDay(day)
        return buildBucket(inWindow, start, subDays(start, -1),
          days <= 7 ? format(day, 'EEE') : format(day, 'M/d'), format(day, 'EEE, MMM d'))
      })
    : eachWeekOfInterval({ start: windowStart, end: NOW }, { weekStartsOn: 1 }).map(wk => {
        const start = startOfWeek(wk, { weekStartsOn: 1 })
        return buildBucket(inWindow, start, subDays(start, -7),
          format(start, 'M/d'), `Week of ${format(start, 'MMM d')}`)
      })

  // Period totals + strength/cardio split from the activity mix.
  const mix = activityMix(inWindow)
  const totalMin = Array.from(mix.values()).reduce((s, m) => s + m, 0)
  const cardioMin = mix.get('Cardio') ?? 0
  const strengthMin = totalMin - cardioMin
  const cardioPct = totalMin > 0 ? Math.round((cardioMin / totalMin) * 100) : 0
  const sessions = inWindow.length
  const avgMin = sessions > 0 ? totalMin / sessions : 0

  // Trend vs the immediately-prior equal-length window.
  const prevStart = startOfDay(subDays(NOW, days * 2 - 1))
  const prev = workouts.filter(w => {
    const t = new Date(w.started_at)
    return t >= prevStart && t < windowStart
  })
  const prevMin = Array.from(activityMix(prev).values()).reduce((s, m) => s + m, 0)
  const trend = delta(totalMin, prevMin)

  // Legend / stack: only categories actually trained in the window.
  const presentCats = ACTIVITY_ORDER.filter(c => (mix.get(c) ?? 0) > 0)

  return (
    <div className="card p-4 min-w-0">
      <SectionHeader
        icon={TrendingUp}
        title="Training Trends"
        right={<PeriodSelector options={['7', '14', '30', '90'] as const} value={period} onChange={setPeriod} />}
        className="mb-3"
      />
      {sessions === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <Dumbbell className="w-6 h-6 text-tx-muted opacity-40" />
          <p className="text-xs text-tx-muted">Log workouts to see your training mix</p>
        </div>
      ) : (
        <>
          {/* Headline metrics */}
          <div className="flex items-end justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-display font-bold text-2xl text-tx-primary tabular-nums">{fmtDuration(totalMin)}</span>
                {trend.pct !== null && (
                  <span className={`text-xs font-semibold ${trend.pct >= 0 ? 'text-success-400' : 'text-error-400'}`}>
                    {trend.pct >= 0 ? '▲' : '▼'} {Math.abs(trend.pct)}%
                  </span>
                )}
              </div>
              <p className="text-[11px] text-tx-muted mt-0.5">
                {sessions} session{sessions === 1 ? '' : 's'} · avg {fmtDuration(avgMin)} · vs prior {days}d
              </p>
            </div>
          </div>

          {/* Legend — present categories only */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-2">
            {presentCats.map(cat => (
              <div key={cat} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ACTIVITY_HEX[cat] }} />
                <span className="text-[10px] text-tx-muted">{cat}</span>
              </div>
            ))}
          </div>

          {/* Stacked time-by-focus columns */}
          <div className="w-full min-w-0">
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={buckets} barCategoryGap={daily ? '22%' : '28%'} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                <YAxis hide />
                <Tooltip content={<TrendTooltip />} cursor={{ fill: 'var(--surface-overlay)', opacity: 0.6, radius: 4 }} />
                {ACTIVITY_ORDER.map((cat, i) => (
                  <Bar
                    key={cat}
                    dataKey={cat}
                    stackId="mix"
                    fill={ACTIVITY_HEX[cat]}
                    stroke="var(--surface-raised)"
                    strokeWidth={1}
                    radius={i === ACTIVITY_ORDER.length - 1 ? [3, 3, 0, 0] : undefined}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Strength vs cardio split */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-tx-secondary">Strength <span className="text-tx-muted tabular-nums">{100 - cardioPct}%</span></span>
              <span className="text-tx-secondary"><span className="text-tx-muted tabular-nums">{cardioPct}%</span> Cardio</span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-surface-overlay">
              <div className="h-full transition-all" style={{ width: `${100 - cardioPct}%`, background: ACTIVITY_HEX.Upper }} />
              <div className="h-full transition-all" style={{ width: `${cardioPct}%`, background: CARDIO_HEX }} />
            </div>
            <p className="text-[10px] text-tx-muted mt-1 tabular-nums">
              {fmtDuration(strengthMin)} strength · {fmtDuration(cardioMin)} cardio
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// Aggregate one bucket's workouts into a Recharts row: minutes per category
// plus totals for the tooltip.
function buildBucket(workouts: types.Workout[], start: Date, end: Date, label: string, range: string): Bucket {
  const inBucket = workouts.filter(w => {
    const t = new Date(w.started_at)
    return t >= start && t < end
  })
  const mix = activityMix(inBucket)
  const row: Bucket = {
    label, range, sessions: inBucket.length, total: 0,
    Cardio: 0, Upper: 0, Lower: 0, Core: 0, 'Full Body': 0,
  }
  let total = 0
  mix.forEach((m, cat: ActivityCategory) => { row[cat] = m; total += m })
  row.total = total
  return row
}
