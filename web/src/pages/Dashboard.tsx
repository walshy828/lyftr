import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AlertCircle, Timer, ArrowRight, BarChart3 } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import Loading from '../components/Loading'
import QuickWeighInSheet from '../components/QuickWeighInSheet'
import { useDashboardData } from '../hooks/useDashboardData'
import { useWorkoutSession } from '../stores/workoutSession'
import { useAuthStore } from '../stores/auth'
import { displayWeight, weightShort } from '../stores/settings'
import { healthMetricsAPI } from '../services/api'
import { todayStr } from '../utils/dateUtils'
import { buildTodayFocus, type FocusAction } from '../utils/todayFocus'
import TodayRings from '../components/today/TodayRings'
import FocusToday from '../components/today/FocusToday'
import { weeklyInsights } from '../components/dashboard/InsightsCard'
import PlanAdherenceHero from '../components/dashboard/PlanAdherenceHero'
import JourneyRoad from '../components/dashboard/JourneyRoad'
import WeightTrendCard from '../components/dashboard/WeightTrendCard'
import TodaysWorkoutCard from '../components/dashboard/TodaysWorkoutCard'
import NutritionTodayCard from '../components/dashboard/NutritionTodayCard'

function greeting(now: Date) {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Today — the daily check-in screen.
 *
 * Top to bottom it answers, in order: where am I today (rings), what's left to
 * do (focus list with one-tap actions), what's the plan (today's session),
 * and am I on track (plan adherence, weight). Long-range analytics live under
 * Trends → Overview so this screen stays short enough to read before coffee.
 */
export default function Dashboard() {
  const navigate = useNavigate()
  const { session } = useWorkoutSession()
  const { user } = useAuthStore()
  const d = useDashboardData()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [steps, setSteps] = useState<number | null>(null)
  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    const t = todayStr()
    healthMetricsAPI.daily('steps', t, t, 'sum')
      .then(rows => setSteps(rows?.length ? rows.reduce((s, r) => s + r.value, 0) : null))
      .catch(() => setSteps(null))
  }, [])

  if (d.loading) return <Loading />

  if (d.error) {
    return (
      <div className="alert-error">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{d.error}</span>
      </div>
    )
  }

  const username = user?.name?.trim() || user?.email?.split('@')[0] || 'there'
  const unit = weightShort(d.settings.weight_unit)
  const lastWeight = d.weightLogs[0] ?? null
  const lastWeightLabel = lastWeight ? `${displayWeight(lastWeight.weight, d.settings.weight_unit)} ${unit}` : undefined
  const workedOutToday = d.workouts.some(w => format(new Date(w.started_at), 'yyyy-MM-dd') === todayStr())

  const focus = buildTodayFocus({
    now, food: d.food, settings: d.settings, lastWeight, lastWeightLabel, todaysPlan: d.todaysPlan,
  })
  const weekly = weeklyInsights({
    workouts: d.workouts, foodHistory: d.foodHistory, weightStats: d.weightStats, settings: d.settings, plan: d.plan,
  })

  const onAction = (a: FocusAction) => {
    if (a === 'weigh') setSheetOpen(true)
    else if (a === 'log-food') navigate(`/food/log?date=${todayStr()}&mode=describe`)
    else if (a === 'start-workout') navigate(session ? '/workout/active' : '/workout/start')
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{format(now, 'EEEE, MMMM d')}</p>
          <h1 className="font-display font-bold text-[26px] leading-tight text-tx-primary mt-0.5 truncate">
            {greeting(now)}, {username}
          </h1>
        </div>
        <Link to="/stats" className="btn-secondary btn-sm flex-shrink-0" aria-label="Open trends">
          <BarChart3 className="w-3.5 h-3.5" /> Trends
        </Link>
      </header>

      {session && (
        <Link to="/workout/active" className="flex items-center justify-between p-3 bg-fuel/10 border border-fuel/30 rounded-2xl hover:bg-fuel/15 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-fuel/20 flex items-center justify-center flex-shrink-0">
              <Timer className="w-4 h-4 text-fuel animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold text-tx-primary">Workout in progress</p>
              <p className="text-xs text-tx-muted">{session.name} — tap to resume</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-fuel flex-shrink-0" />
        </Link>
      )}

      <TodayRings
        food={d.food} settings={d.settings} steps={steps}
        todaysPlan={d.todaysPlan} workedOutToday={workedOutToday}
      />

      <FocusToday items={focus} weekly={weekly} onAction={onAction} />

      <TodaysWorkoutCard
        today={d.todaysPlan}
        hasSchedule={!!d.todaysPlan && (d.todaysPlan.programs.length > 0 || d.todaysPlan.source !== 'rest')}
      />

      {d.plan && d.adherence && (
        <PlanAdherenceHero plan={d.plan} adherence={d.adherence} weightStats={d.weightStats} settings={d.settings} />
      )}

      <WeightTrendCard
        weightLogs={d.weightLogs} weightStats={d.weightStats} settings={d.settings}
        profile={d.profile} plan={d.plan} onLog={() => setSheetOpen(true)}
      />

      {d.plan && <JourneyRoad plan={d.plan} weightLogs={d.weightLogs} settings={d.settings} />}

      <NutritionTodayCard food={d.food} settings={d.settings} />

      <Link to="/stats" className="card-interactive flex items-center justify-between px-4 py-3.5">
        <span className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-brand-400" />
          <span>
            <span className="block text-sm font-semibold text-tx-primary">All trends</span>
            <span className="block text-xs text-tx-muted">Consistency, training mix, muscle coverage, sleep, heart</span>
          </span>
        </span>
        <ArrowRight className="w-4 h-4 text-tx-muted" />
      </Link>

      <QuickWeighInSheet
        isOpen={sheetOpen}
        lastValue={lastWeight ? displayWeight(lastWeight.raw_weight ?? lastWeight.weight, d.settings.weight_unit) : null}
        lastLog={lastWeight}
        onClose={() => setSheetOpen(false)}
        onSuccess={log => { d.addWeightLog(log); setSheetOpen(false) }}
      />
    </div>
  )
}
