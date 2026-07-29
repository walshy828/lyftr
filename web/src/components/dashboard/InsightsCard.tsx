import { Lightbulb } from 'lucide-react'
import { SectionHeader, InsightList } from '../ui'
import * as types from '../../types'
import { displayWeight, weightShort } from '../../stores/settings'
import {
  weekRange, weeklyTraining, weeklyNutrition, daysSinceLastWorkout,
  untrainedFocusRegions, goalDirection, buildInsights,
} from '../../utils/dashboardMetrics'

const NOW = new Date()

// Translates the raw numbers into "what you're doing well / where to focus."
// Renders nothing when there's not enough signal to say anything useful.
export default function InsightsCard({
  workouts, foodHistory, weightStats, settings, plan,
}: {
  workouts: types.Workout[]
  foodHistory: types.FoodHistoryPoint[]
  weightStats: types.WeightStats | null
  settings: types.UserSettings
  plan: types.CurrentNutritionGoal | null
}) {
  const thisWeek = weekRange(NOW, 0)
  const nutrition = weeklyNutrition(foodHistory, settings.protein_target, thisWeek, NOW)
  const training = weeklyTraining(workouts, thisWeek)
  const goal = plan && weightStats ? goalDirection(plan.goal.target_weight, weightStats.starting) : null
  const change7d = weightStats ? displayWeight(weightStats.change_7d, settings.weight_unit) : 0

  const insights = buildInsights({
    nutrition,
    calorieTarget: settings.calorie_target,
    sessionsThisWeek: training.sessions,
    daysSinceWorkout: daysSinceLastWorkout(workouts, NOW),
    untrainedRegions: untrainedFocusRegions(workouts, NOW, 14),
    weightChange7d: weightStats && weightStats.change_7d < 0 ? -Math.abs(change7d) : Math.abs(change7d),
    weightUnit: weightShort(settings.weight_unit),
    goal,
  })

  if (insights.length === 0) return null

  return (
    <div className="card p-4">
      <SectionHeader icon={Lightbulb} title="Insights" className="mb-3" />
      <InsightList items={insights} />
    </div>
  )
}
