import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck } from 'lucide-react'
import { format } from 'date-fns'
import { weekRange, weeklyTraining, weeklyNutrition } from '../../utils/dashboardMetrics'
import { displayWeight, weightShort } from '../../stores/settings'
import * as types from '../../types'

interface Props {
  now: Date
  workouts: types.Workout[]
  foodHistory: types.FoodHistoryPoint[]
  weightLogs: types.WeightLog[]
  settings: types.UserSettings
}

/**
 * Early in the week (Mon–Tue), Today leads into last week's recap: the three
 * numbers that decide a week — logged days, average calories vs target,
 * weight change — plus training, with a link to the full weekly breakdown.
 */
export default function WeekInReview({ now, workouts, foodHistory, weightLogs, settings }: Props) {
  const day = now.getDay() // 0 Sun .. 6 Sat
  if (day !== 1 && day !== 2) return null

  const last = weekRange(now, 1)
  const n = weeklyNutrition(foodHistory, settings.protein_target, last, now)
  const t = weeklyTraining(workouts, last)
  const inWeek = weightLogs
    .filter(l => { const d = new Date(l.logged_at); return d >= last.start && d <= last.end })
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime())
  const change = inWeek.length >= 2 ? inWeek[inWeek.length - 1].weight - inWeek[0].weight : null
  const unit = weightShort(settings.weight_unit)
  const calDiff = n.daysLogged ? Math.round(n.avgCalories - settings.calorie_target) : null

  const stats = [
    { label: 'Days logged', value: `${n.daysLogged}/7`, good: n.daysLogged >= 6 },
    { label: 'Avg kcal', value: n.daysLogged ? Math.round(n.avgCalories).toLocaleString() : '—',
      sub: calDiff === null ? '' : calDiff > 0 ? `+${calDiff} vs target` : `${calDiff} vs target`, good: calDiff !== null && calDiff <= 100 },
    { label: 'Weight', value: change === null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${displayWeight(Math.abs(change), settings.weight_unit)}`,
      sub: change === null ? 'weigh in more' : unit, good: change !== null && change < 0 },
    { label: 'Sessions', value: String(t.sessions), good: t.sessions >= 3 },
  ]

  return (
    <Link to="/stats/weekly" className="card-interactive block p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="eyebrow flex items-center gap-1.5">
          <CalendarCheck className="w-3.5 h-3.5" /> Last week · {format(last.start, 'MMM d')}–{format(last.end, 'MMM d')}
        </p>
        <span className="text-xs text-brand-400 inline-flex items-center gap-1">Review <ArrowRight className="w-3 h-3" /></span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {stats.map(s => (
          <div key={s.label} className="min-w-0">
            <p className={`text-lg font-bold tabular-nums leading-tight ${s.good ? 'text-move' : 'text-tx-primary'}`}>{s.value}</p>
            <p className="text-[10px] text-tx-muted leading-tight">{s.label}</p>
            {s.sub && <p className="text-[10px] text-tx-muted truncate">{s.sub}</p>}
          </div>
        ))}
      </div>
    </Link>
  )
}
