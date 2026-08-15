import { Dumbbell, Flame, Scale, HeartPulse } from 'lucide-react'
import { StatTile, DeltaBadge } from '../ui'
import * as types from '../../types'
import { displayWeight, weightShort } from '../../stores/settings'
import {
  weekRange, weeklyTraining, weeklyCardio, weeklyNutrition, delta, goalDirection,
  elapsedDays, firstDaysOf,
} from '../../utils/dashboardMetrics'

const NOW = new Date()

// The four-pillar "how's this week going, vs last week" summary. Every tile
// carries a week-over-week DeltaBadge so the user reads direction at a glance.
export default function ThisWeekScorecard({
  workouts, cardioSessions, foodHistory, weightStats, settings, plan,
}: {
  workouts: types.Workout[]
  /** Cardio sessions synced from Health Connect — a separate source from `workouts`. */
  cardioSessions: types.CardioSession[]
  foodHistory: types.FoodHistoryPoint[]
  weightStats: types.WeightStats | null
  settings: types.UserSettings
  plan: types.CurrentNutritionGoal | null
}) {
  const wUnit = weightShort(settings.weight_unit)
  const thisWeek = weekRange(NOW, 0)
  const daysSoFar = elapsedDays(thisWeek, NOW)
  // Compare against the same slice of last week (Mon–Wed vs Mon–Wed), not its
  // full seven days — otherwise every week opens looking like a collapse.
  const lastWeek = firstDaysOf(weekRange(NOW, 1), daysSoFar)

  const trainNow = weeklyTraining(workouts, thisWeek)
  const trainPrev = weeklyTraining(workouts, lastWeek)
  const sessionsDelta = delta(trainNow.sessions, trainPrev.sessions)

  const cardioNow = weeklyCardio(cardioSessions, thisWeek)
  const cardioPrev = weeklyCardio(cardioSessions, lastWeek)
  const cardioDelta = delta(cardioNow.sessions, cardioPrev.sessions)

  const nutNow = weeklyNutrition(foodHistory, settings.protein_target, thisWeek, NOW)
  const nutPrev = weeklyNutrition(foodHistory, settings.protein_target, lastWeek, NOW)
  const calDelta = delta(Math.round(nutNow.avgCalories), Math.round(nutPrev.avgCalories))

  // Weight direction only reads as good/bad when a plan tells us the intent.
  const goal = plan && weightStats
    ? goalDirection(plan.goal.target_weight, weightStats.starting)
    : null
  const weightGood = goal === 'loss' ? 'down' : goal === 'gain' ? 'up' : 'none'
  const change7dDisp = weightStats ? displayWeight(Math.abs(weightStats.change_7d), settings.weight_unit) : 0
  const change7dSigned = weightStats && weightStats.change_7d < 0 ? -change7dDisp : change7dDisp

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 px-0.5">
        <h2 className="stat-label">This Week</h2>
        <span className="text-[11px] text-tx-muted">vs last week</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile
          label="Training"
          to="/workouts"
          linkLabel="Training this week — view workouts"
          icon={Dumbbell}
          accent="#2563eb"
          value={trainNow.sessions}
          sub={trainNow.sessions === 1 ? 'session' : 'sessions'}
          delta={<DeltaBadge value={sessionsDelta.abs} goodDirection="up" />}
        />
        <StatTile
          label="Synced Cardio"
          to="/health"
          linkLabel="Synced cardio this week — view health"
          icon={HeartPulse}
          accent="#ef4444"
          value={cardioNow.sessions}
          sub={cardioNow.sessions === 1 ? 'session' : 'sessions'}
          delta={<DeltaBadge value={cardioDelta.abs} goodDirection="up" />}
        />
        <StatTile
          label="Nutrition"
          to="/food"
          linkLabel="Nutrition this week — view food log"
          icon={Flame}
          accent="#00b8d9"
          value={nutNow.daysLogged > 0 ? Math.round(nutNow.avgCalories).toLocaleString() : '—'}
          sub={nutNow.daysLogged > 0 ? `kcal · ${nutNow.daysLogged}/${daysSoFar} logged` : 'not logged'}
          delta={
            nutNow.daysLogged > 0 && nutPrev.daysLogged > 0
              ? <DeltaBadge value={calDelta.abs} goodDirection="none" />
              : undefined
          }
        />
        <StatTile
          label="Weight"
          to="/weight"
          linkLabel="Weight this week — view weight log"
          icon={Scale}
          accent="#6366f1"
          value={weightStats ? displayWeight(weightStats.latest, settings.weight_unit) : '—'}
          unit={weightStats ? wUnit : undefined}
          sub={weightStats ? '7-day' : 'no logs'}
          delta={
            weightStats
              ? <DeltaBadge value={change7dSigned} goodDirection={weightGood} suffix={` ${wUnit}`} decimals={1} />
              : undefined
          }
        />
      </div>
    </div>
  )
}
