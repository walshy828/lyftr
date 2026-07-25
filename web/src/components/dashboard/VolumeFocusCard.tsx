import { useState } from 'react'
import { TrendingUp, Dumbbell } from 'lucide-react'
import { format, subDays, isSameDay, eachDayOfInterval, startOfWeek, endOfWeek } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { SectionHeader } from '../ui'
import PeriodSelector from '../PeriodSelector'
import * as types from '../../types'
import { displayVolume, weightShort } from '../../stores/settings'
import { calcVolume } from '../../utils/dashboardMetrics'
import { FOCUS_HEX, FOCUS_ORDER, focusOf, TOOLTIP_STYLE, AXIS_TICK, CURSOR_FILL, type FocusCategory } from '../../utils/chartTheme'

const NOW = new Date()

// A workout's dominant focus, weighted by set count.
function dominantFocus(w: types.Workout): FocusCategory | null {
  const counts = new Map<FocusCategory, number>()
  for (const ex of w.exercises ?? []) {
    const cat = focusOf(ex.exercise?.muscle_group ?? '')
    if (cat) counts.set(cat, (counts.get(cat) || 0) + (ex.sets ?? []).length)
  }
  let top: FocusCategory | null = null
  let max = 0
  counts.forEach((v, k) => { if (v > max) { max = v; top = k } })
  return top
}

// "How much am I lifting over time, and what am I training?" Volume bars colored
// by focus, with a WoW volume delta and the current week's day dots.
export default function VolumeFocusCard({ workouts, settings }: {
  workouts: types.Workout[]
  settings: types.UserSettings
}) {
  const [period, setPeriod] = useState<'7' | '14' | '30' | '90'>('7')
  const wUnit = weightShort(settings.weight_unit)
  const days = Number(period)

  const periodWorkouts = workouts.filter(w => new Date(w.started_at) >= subDays(NOW, days))
  const chartData = periodWorkouts.slice().reverse().map(w => {
    const focus = dominantFocus(w)
    return {
      date: format(new Date(w.started_at), 'M/d'),
      volume: displayVolume(calcVolume(w), settings.weight_unit),
      duration: Math.round(w.duration / 60),
      name: w.name,
      focus,
      focusColor: focus ? FOCUS_HEX[focus] : '#6366f1',
    }
  })

  const prevWorkouts = workouts.filter(w => {
    const t = new Date(w.started_at)
    return t < subDays(NOW, days) && t >= subDays(NOW, days * 2)
  })
  const periodVolume = periodWorkouts.reduce((s, w) => s + calcVolume(w), 0)
  const prevVolume = prevWorkouts.reduce((s, w) => s + calcVolume(w), 0)
  const volumeChangePct = prevVolume > 0 ? Math.round(((periodVolume - prevVolume) / prevVolume) * 100) : null
  const avgDuration = periodWorkouts.length > 0
    ? Math.round(periodWorkouts.reduce((s, w) => s + w.duration, 0) / periodWorkouts.length / 60) : 0

  const weekStart = startOfWeek(NOW, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: endOfWeek(NOW, { weekStartsOn: 1 }) })

  return (
    <div className="card p-4">
      <SectionHeader
        icon={TrendingUp}
        title="Volume & Focus"
        right={<PeriodSelector options={['7', '14', '30', '90'] as const} value={period} onChange={setPeriod} />}
        className="mb-3"
      />
      {chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <Dumbbell className="w-6 h-6 text-tx-muted opacity-40" />
          <p className="text-xs text-tx-muted">Log workouts to see trends</p>
        </div>
      ) : (
        <>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-2">
            {FOCUS_ORDER.map(cat => (
              <div key={cat} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: FOCUS_HEX[cat] }} />
                <span className="text-[10px] text-tx-muted">{cat}</span>
              </div>
            ))}
          </div>
          <div className="w-full min-w-0">
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={chartData} barSize={days > 30 ? 6 : 18} barCategoryGap="30%">
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis hide />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, _n: string, props: { payload?: { duration: number; focus: string | null } }) => [
                    `${v.toLocaleString()} ${wUnit} · ${props.payload?.duration ?? 0} min${props.payload?.focus ? ` · ${props.payload.focus}` : ''}`,
                    'Volume',
                  ]}
                  labelFormatter={(label: string) => chartData.find(d => d.date === label)?.name || label}
                  cursor={{ fill: CURSOR_FILL, radius: 4 }}
                />
                <Bar dataKey="volume" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.focusColor} fillOpacity={i === chartData.length - 1 ? 1 : 0.65} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-tx-muted mt-2">
            {periodWorkouts.length} session{periodWorkouts.length === 1 ? '' : 's'}
            {avgDuration > 0 && ` · avg ${avgDuration} min`}
            {volumeChangePct !== null && (
              <span className={volumeChangePct >= 0 ? 'text-success-400' : 'text-error-400'}>
                {' · '}{volumeChangePct >= 0 ? '▲' : '▼'} {Math.abs(volumeChangePct)}% volume vs prior {days}d
              </span>
            )}
          </p>
          <div className="flex items-center justify-between mt-4 px-1">
            {weekDays.map((day, i) => {
              const hasWorkout = workouts.some(w => isSameDay(new Date(w.started_at), day))
              const isToday = isSameDay(day, NOW)
              const isFuture = day > NOW
              return (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <span className={`text-[10px] font-semibold ${isToday ? 'text-brand-400' : 'text-tx-muted'}`}>{format(day, 'EEEEE')}</span>
                  <div className={`w-3 h-3 rounded-full transition-all ${
                    hasWorkout ? 'bg-brand-500 shadow-sm shadow-brand-500/50' :
                    isToday ? 'bg-transparent ring-2 ring-brand-500/60' :
                    isFuture ? 'bg-surface-border/20' : 'bg-surface-border/60'
                  }`} />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
