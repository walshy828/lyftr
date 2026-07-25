import { Link } from 'react-router-dom'
import { MacroBar } from '../ui'
import * as types from '../../types'
import { ENERGY_COLORS } from '../../utils/chartTheme'

// "How's today's intake against my targets?" Calorie headline + macro/nutrient
// bars that recolor when over target.
export default function NutritionTodayCard({ food, settings }: {
  food: types.DailyStats
  settings: types.UserSettings
}) {
  const calPct = Math.min(100, (food.total_calories / settings.calorie_target) * 100) || 0
  return (
    <div className="card p-4 overflow-hidden min-w-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-title">Today's Nutrition</h2>
        <Link to="/food" className="text-xs text-brand-400 hover:text-brand-300 transition-colors flex-shrink-0">Log →</Link>
      </div>

      <div className="flex items-baseline gap-1.5 mb-3">
        <span className="text-3xl font-bold text-tx-primary tabular-nums leading-none">{Math.round(food.total_calories)}</span>
        <span className="text-xs text-tx-muted">/ {settings.calorie_target} kcal</span>
        <div className="flex-1" />
        <span className="text-xs text-tx-muted tabular-nums">{Math.round(calPct)}%</span>
      </div>
      <div className="progress-track mb-4">
        <div className="progress-bar" style={{ width: `${calPct}%`, background: ENERGY_COLORS.calories }} />
      </div>

      <div className="space-y-2.5">
        <MacroBar label="Protein" value={food.total_protein} target={settings.protein_target} color={ENERGY_COLORS.protein} unit="g" />
        <MacroBar label="Carbs" value={food.total_carbs} target={settings.carb_target} color={ENERGY_COLORS.carbs} unit="g" />
        <MacroBar label="Fat" value={food.total_fat} target={settings.fat_target} color={ENERGY_COLORS.fat} unit="g" />
        <MacroBar label="Cholesterol" value={food.total_cholesterol} target={settings.cholesterol_target} color="#f472b6" unit="mg" />
        <MacroBar label="Sodium" value={food.total_sodium} target={settings.sodium_target} color="#38bdf8" unit="mg" />
      </div>
    </div>
  )
}
