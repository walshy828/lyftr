import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { workoutAPI, foodAPI, weightAPI, userAPI, profileAPI, weightPlanAPI } from '../services/api'
import { useSettingsStore } from '../stores/settings'
import * as types from '../types'

const TODAY = new Date()

const DEFAULT_FOOD: types.DailyStats = {
  date: format(TODAY, 'yyyy-MM-dd'),
  total_calories: 0, total_protein: 0, total_carbs: 0, total_fat: 0, total_fiber: 0,
  total_sodium: 0, total_cholesterol: 0, workout_count: 0,
}

export interface DashboardData {
  workouts: types.Workout[]
  food: types.DailyStats
  foodHistory: types.FoodHistoryPoint[]
  weightLogs: types.WeightLog[]
  weightStats: types.WeightStats | null
  settings: types.UserSettings
  profile: types.ProfileWithBMI | null
  plan: types.CurrentNutritionGoal | null
  adherence: types.WeightPlanAdherence | null
  loading: boolean
  error: string | null
  /** Optimistically merge a freshly-logged weight + refresh stats. */
  addWeightLog: (log: types.WeightLog) => void
}

// Single-shot loader for the home dashboard. Every call has its own fallback so
// one failing endpoint (notably /weight/plan/current, which 404s when no plan
// is active) never blanks the whole page.
export function useDashboardData(): DashboardData {
  const { settings: storedSettings } = useSettingsStore()

  const [workouts, setWorkouts] = useState<types.Workout[]>([])
  const [food, setFood] = useState<types.DailyStats>(DEFAULT_FOOD)
  const [foodHistory, setFoodHistory] = useState<types.FoodHistoryPoint[]>([])
  const [weightLogs, setWeightLogs] = useState<types.WeightLog[]>([])
  const [weightStats, setWeightStats] = useState<types.WeightStats | null>(null)
  const [settings, setSettings] = useState<types.UserSettings>(storedSettings)
  const [profile, setProfile] = useState<types.ProfileWithBMI | null>(null)
  const [plan, setPlan] = useState<types.CurrentNutritionGoal | null>(null)
  const [adherence, setAdherence] = useState<types.WeightPlanAdherence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      workoutAPI.list({ limit: 150 }).catch(() => []),
      foodAPI.stats(format(TODAY, 'yyyy-MM-dd')).catch(() => DEFAULT_FOOD),
      foodAPI.history(90).catch(() => []),
      weightAPI.list({ limit: 90 }).catch(() => []),
      weightAPI.stats().catch(() => null),
      userAPI.getSettings().catch(() => storedSettings),
      profileAPI.get().catch(() => null),
      weightPlanAPI.current().catch(() => null), // 404 when no active plan
    ])
      .then(([ws, fs, fh, wl, wst, s, prof, cur]) => {
        setWorkouts(ws || [])
        setFood(fs || DEFAULT_FOOD)
        setFoodHistory(fh || [])
        setWeightLogs(wl || [])
        setWeightStats(wst)
        setSettings(s || storedSettings)
        setProfile(prof)
        setPlan(cur)
        // Adherence is a second round-trip (may hit the AI motivation cache);
        // only fetch it when a plan actually exists.
        if (cur) weightPlanAPI.adherence().then(setAdherence).catch(() => setAdherence(null))
      })
      .catch(err => setError(err?.message || 'Failed to load'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addWeightLog = (log: types.WeightLog) => {
    setWeightLogs(prev =>
      [log, ...prev].sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime()),
    )
    weightAPI.stats().then(setWeightStats).catch(() => {})
  }

  return {
    workouts, food, foodHistory, weightLogs, weightStats, settings, profile, plan, adherence,
    loading, error, addWeightLog,
  }
}
