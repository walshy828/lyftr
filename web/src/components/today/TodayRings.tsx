import { Link } from 'react-router-dom'
import Ring from '../ui/Ring'
import { MACRO_COLORS } from '../../utils/macroColors'
import * as types from '../../types'

interface Props {
  food: types.DailyStats
  settings: types.UserSettings
  steps: number | null
  todaysPlan: types.ScheduledDay | null
  workedOutToday: boolean
  /** Synced cardio minutes today (Health Connect). */
  cardioMinutes?: number
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`)

/**
 * Today at a glance: four rings, one per daily lever — energy, protein,
 * movement, training. Each ring is a link to where you'd act on it.
 */
export default function TodayRings({ food, settings, steps, todaysPlan, workedOutToday, cardioMinutes = 0 }: Props) {
  const stepGoal = settings.step_goal || 10_000
  const kcal = food.total_calories
  const left = settings.calorie_target - kcal
  const planned = todaysPlan?.programs ?? []
  const doneCount = planned.filter(p => p.completed_workout_id).length
  // Activity outside the plan still counts: a synced run on a lifting day
  // fills half the ring until the planned session is done too.
  const trainValue = planned.length
    ? Math.max(doneCount / planned.length, workedOutToday && doneCount < planned.length ? 0.5 : 0)
    : workedOutToday ? 1 : 0
  const trainLabel = planned.length
    ? `${doneCount}/${planned.length}`
    : cardioMinutes > 0 ? `${cardioMinutes}m` : workedOutToday ? 'Done' : todaysPlan?.source === 'rest' ? 'Rest' : '—'
  const trainFoot = planned.length
    ? (cardioMinutes > 0 && doneCount < planned.length ? `+${cardioMinutes}m cardio · ${planned[0].name}` : planned[0].name)
    : cardioMinutes > 0 ? 'Cardio' : todaysPlan?.source === 'rest' ? 'Recovery day' : 'Nothing planned'

  const tiles = [
    {
      to: '/food', name: 'Calories', color: 'rgb(var(--c-fuel))', over: 'rgb(var(--c-heart))',
      value: kcal / settings.calorie_target,
      big: left >= 0 ? k(left) : `+${k(-left)}`,
      small: left >= 0 ? 'left' : 'over',
      foot: `${Math.round(kcal)} / ${settings.calorie_target}`,
    },
    {
      to: '/food', name: 'Protein', color: MACRO_COLORS.protein, over: MACRO_COLORS.protein,
      value: food.total_protein / settings.protein_target,
      big: `${Math.round(food.total_protein)}`, small: 'g',
      foot: `of ${settings.protein_target} g`,
    },
    {
      to: '/stats?tab=activity', name: 'Steps', color: 'rgb(var(--c-move))', over: 'rgb(var(--c-move))',
      value: (steps ?? 0) / stepGoal,
      big: steps === null ? '—' : k(steps), small: steps === null ? 'no sync' : 'steps',
      foot: `goal ${k(stepGoal)}`,
    },
    {
      to: '/train', name: 'Training', color: 'rgb(var(--c-train))', over: 'rgb(var(--c-train))',
      value: trainValue, big: trainLabel, small: planned.length ? 'sessions' : cardioMinutes > 0 ? 'cardio' : '',
      foot: trainFoot,
    },
  ]

  return (
    <div className="card p-4">
      <div className="grid grid-cols-4 gap-1">
        {tiles.map(t => (
          <Link key={t.name} to={t.to} className="flex flex-col items-center gap-1.5 rounded-xl py-1 hover:bg-surface-overlay/60 transition-colors min-w-0">
            <Ring value={t.value} color={t.color} size={68} stroke={6} overColor={t.over} label={`${t.name}: ${t.big} ${t.small}`}>
              <span className="text-[15px] font-bold text-tx-primary tabular-nums leading-none">{t.big}</span>
              {t.small && <span className="text-[9px] text-tx-muted mt-0.5 leading-none">{t.small}</span>}
            </Ring>
            <span className="text-[11px] font-semibold text-tx-secondary leading-none">{t.name}</span>
            <span className="text-[10px] text-tx-muted leading-tight text-center truncate w-full px-0.5">{t.foot}</span>
          </Link>
        ))}
      </div>
      {/* Macro split under the rings: where today's calories came from */}
      {kcal > 0 && <MacroSplit food={food} />}
    </div>
  )
}

function MacroSplit({ food }: { food: types.DailyStats }) {
  const p = food.total_protein * 4, c = food.total_carbs * 4, f = food.total_fat * 9
  const t = p + c + f || 1
  const parts = [
    { k: 'Protein', v: p, g: food.total_protein, color: MACRO_COLORS.protein },
    { k: 'Carbs', v: c, g: food.total_carbs, color: MACRO_COLORS.carbs },
    { k: 'Fat', v: f, g: food.total_fat, color: MACRO_COLORS.fat },
  ]
  return (
    <div className="mt-4 pt-3 border-t border-surface-border">
      <div className="flex h-1.5 rounded-full overflow-hidden gap-0.5">
        {parts.map(x => <div key={x.k} style={{ width: `${(x.v / t) * 100}%`, background: x.color }} />)}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2.5 tabular-nums">
        {parts.map(x => (
          <div key={x.k} className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] text-tx-muted">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: x.color }} />{x.k}
            </p>
            <p className="text-xs text-tx-secondary mt-0.5">
              <span className="font-semibold text-tx-primary">{Math.round(x.g)}g</span> · {Math.round((x.v / t) * 100)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
