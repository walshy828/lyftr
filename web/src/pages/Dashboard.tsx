import { useState } from 'react'
import { format } from 'date-fns'
import { AlertCircle, Play, Timer, ArrowRight, Utensils } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import Loading from '../components/Loading'
import QuickWeighInSheet from '../components/QuickWeighInSheet'
import { useDashboardData } from '../hooks/useDashboardData'
import { useWorkoutSession } from '../stores/workoutSession'
import { useAuthStore } from '../stores/auth'
import { displayWeight } from '../stores/settings'
import ThisWeekScorecard from '../components/dashboard/ThisWeekScorecard'
import PlanAdherenceHero from '../components/dashboard/PlanAdherenceHero'
import JourneyRoad from '../components/dashboard/JourneyRoad'
import InsightsCard from '../components/dashboard/InsightsCard'
import WeightTrendCard from '../components/dashboard/WeightTrendCard'
import ConsistencyHeatmap from '../components/dashboard/ConsistencyHeatmap'
import TrainingTrendsCard from '../components/dashboard/TrainingTrendsCard'
import NutritionTodayCard from '../components/dashboard/NutritionTodayCard'
import NutritionTrendCard from '../components/dashboard/NutritionTrendCard'
import MuscleBalanceCard from '../components/dashboard/MuscleBalanceCard'
import LastWorkoutCard from '../components/dashboard/LastWorkoutCard'

const TODAY = new Date()

function greeting() {
  const h = TODAY.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { session } = useWorkoutSession()
  const { user } = useAuthStore()
  const d = useDashboardData()
  const [sheetOpen, setSheetOpen] = useState(false)

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

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Header */}
      {/* Stacks on mobile so the greeting gets the full width instead of being
          squeezed into a narrow column by the two action buttons. */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-tx-muted uppercase tracking-wider font-medium">{format(TODAY, 'EEEE, MMMM d')}</p>
          <h1 className="font-display font-bold text-2xl text-tx-primary mt-0.5">{greeting()}, {username}</h1>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-shrink-0">
          <button onClick={() => navigate('/food/log')} className="btn-secondary btn-sm flex-1 sm:flex-none">
            <Utensils className="w-3.5 h-3.5" /> Log Food
          </button>
          <button onClick={() => navigate('/workout/start')} className="btn-primary btn-sm flex-1 sm:flex-none">
            <Play className="w-3.5 h-3.5" /> {session ? 'Resume' : 'Start'}
          </button>
        </div>
      </div>

      {/* Active session banner */}
      {session && (
        <Link to="/workout/active" className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl hover:bg-amber-500/15 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
              <Timer className="w-4 h-4 text-amber-400 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-300">Workout in progress</p>
              <p className="text-xs text-amber-400/70">{session.name} — tap to resume</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-amber-400 flex-shrink-0" />
        </Link>
      )}

      {/* This week — the headline synthesis */}
      <ThisWeekScorecard
        workouts={d.workouts} foodHistory={d.foodHistory} weightStats={d.weightStats}
        settings={d.settings} plan={d.plan}
      />

      {/* Plan adherence hero (only with an active plan) */}
      {d.plan && d.adherence && (
        <PlanAdherenceHero plan={d.plan} adherence={d.adherence} weightStats={d.weightStats} settings={d.settings} />
      )}

      {/* The road ahead. Deliberately a separate card from the hero above:
          that one answers "where am I right now", this one "where am I
          heading". It needs no adherence data, so it renders on a brand-new
          plan the hero can't yet describe. */}
      {d.plan && (
        <JourneyRoad plan={d.plan} weightLogs={d.weightLogs} settings={d.settings} />
      )}

      {/* Insights */}
      <InsightsCard
        workouts={d.workouts} foodHistory={d.foodHistory} weightStats={d.weightStats}
        settings={d.settings} plan={d.plan}
      />

      {/* Weight trend */}
      <WeightTrendCard
        weightLogs={d.weightLogs} weightStats={d.weightStats} settings={d.settings}
        profile={d.profile} plan={d.plan} onLog={() => setSheetOpen(true)}
      />

      {/* Nutrition: today + trend */}
      <div className="grid lg:grid-cols-2 gap-4 min-w-0">
        <NutritionTodayCard food={d.food} settings={d.settings} />
        <NutritionTrendCard foodHistory={d.foodHistory} settings={d.settings} />
      </div>

      {/* Training trends (mix + focus over time) + consistency */}
      <TrainingTrendsCard workouts={d.workouts} />
      {/* Half a year, shaded by time invested rather than session count.
          Both choices depend on the server-side aggregate: the old client-side
          version could only see one page of workouts, so a longer window would
          have rendered as a wall of false blanks. Duration shading matters
          because almost every training day holds exactly one workout — a
          count-based scale is effectively binary and says nothing beyond
          "showed up". */}
      <ConsistencyHeatmap
        daily={d.training?.daily ?? []}
        streak={d.training?.streak}
        weeks={26}
        metric="duration"
      />

      {/* Last workout + muscle balance */}
      <div className="grid lg:grid-cols-2 gap-4 min-w-0">
        <LastWorkoutCard workouts={d.workouts} settings={d.settings} />
        <MuscleBalanceCard workouts={d.workouts} />
      </div>

      <QuickWeighInSheet
        isOpen={sheetOpen}
        lastValue={d.weightLogs[0] ? displayWeight(d.weightLogs[0].weight, d.settings.weight_unit) : null}
        lastLog={d.weightLogs[0] ?? null}
        onClose={() => setSheetOpen(false)}
        onSuccess={log => { d.addWeightLog(log); setSheetOpen(false) }}
      />
    </div>
  )
}
