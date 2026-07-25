import { Link } from 'react-router-dom'
import { Target, Utensils, Dumbbell, Flame, Sparkles, ArrowRight, Check, TrendingUp } from 'lucide-react'
import * as types from '../../types'
import { displayWeight, weightShort } from '../../stores/settings'
import { goalDirection, goalProgress } from '../../utils/dashboardMetrics'

// The at-a-glance answer to "am I on track to my goal, and by how much?" Shown
// only when a plan is active. Combines the on-track verdict, a goal-progress bar
// with a "where the plan expects you" marker, the week's adherence sub-stats,
// and the AI motivational note.
export default function PlanAdherenceHero({
  plan, adherence, weightStats, settings,
}: {
  plan: types.CurrentNutritionGoal
  adherence: types.WeightPlanAdherence
  weightStats: types.WeightStats | null
  settings: types.UserSettings
}) {
  const wUnit = weightShort(settings.weight_unit)
  const behind = adherence.behind_plan
  const target = plan.goal.target_weight
  const starting = weightStats?.starting ?? target
  const latest = weightStats?.latest ?? starting
  const dir = goalDirection(target, starting)

  // Progress toward goal, plus where the plan projects you should be by now.
  const progress = goalProgress(starting, latest, target)
  const projections = plan.projections ?? []
  const lastWeek = projections.reduce((m, p) => Math.max(m, p.week), 0)
  const nearest = projections.reduce<types.WeightPlanProjectionPoint | null>((best, p) => {
    if (!best) return p
    return Math.abs(p.week - adherence.weeks_into_plan) < Math.abs(best.week - adherence.weeks_into_plan) ? p : best
  }, null)
  const expectedProgress = nearest ? goalProgress(starting, nearest.expected_weight, target) : null

  const changedLbs = Math.abs(starting - latest)
  const totalLbs = Math.abs(starting - target)
  const changedVerb = dir === 'gain' ? 'Gained' : 'Lost'
  const pctThere = Math.round(progress * 100)
  const variance = Math.abs(displayWeight(adherence.variance_lbs, settings.weight_unit))

  const accent = behind ? '#f59e0b' : '#10b981'

  return (
    <div
      className="card p-4 sm:p-5 relative overflow-hidden"
      style={{ borderColor: `${accent}55`, background: `linear-gradient(180deg, ${accent}0d, transparent 60%)` }}
    >
      {/* Header: title + verdict + week */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${accent}1a` }}>
            <Target className="w-4 h-4" style={{ color: accent }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-tx-primary">Weight-Loss Plan</p>
            <p className="text-[11px] text-tx-muted">
              {lastWeek > 0 ? `Week ${Math.min(adherence.weeks_into_plan, lastWeek)} of ${lastWeek}` : 'Active plan'}
            </p>
          </div>
        </div>
        <span
          className="badge flex-shrink-0"
          style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}33` }}
        >
          {behind ? <TrendingUp className="w-3 h-3" /> : <Check className="w-3 h-3" />}
          {behind ? 'Behind plan' : 'On track'}
        </span>
      </div>

      {/* Goal progress */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-sm text-tx-primary">
            <span className="font-semibold">{changedVerb} {displayWeight(changedLbs, settings.weight_unit)}</span>
            <span className="text-tx-muted"> of {displayWeight(totalLbs, settings.weight_unit)} {wUnit}</span>
          </span>
          <span className="text-sm font-bold tabular-nums" style={{ color: accent }}>{pctThere}%</span>
        </div>
        {/* Bar with a plan-expectation marker */}
        <div className="relative h-2 bg-surface-overlay rounded-full overflow-visible">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pctThere}%`, background: accent }} />
          {expectedProgress !== null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-tx-secondary"
              style={{ left: `${Math.max(0, Math.min(100, expectedProgress * 100))}%` }}
              title="Where your plan expects you"
            />
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] text-tx-muted">
            Goal {displayWeight(target, settings.weight_unit)} {wUnit}
          </span>
          <span className="text-[11px]" style={{ color: accent }}>
            {variance < 0.1 ? 'Right on plan' : `${variance} ${wUnit} ${behind ? 'behind' : 'ahead of'} plan`}
          </span>
        </div>
      </div>

      {/* Adherence sub-stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <SubStat icon={Utensils} color="#00b8d9" value={`${adherence.days_logged_food}/7`} label="days logged" />
        <SubStat icon={Dumbbell} color="#2563eb" value={adherence.workouts_last_7d} label="workout days" />
        <SubStat icon={Flame} color="#f59e0b" value={Math.round(adherence.avg_calories).toLocaleString()} label="avg kcal" />
      </div>

      {/* Motivational note */}
      {adherence.motivational_note && (
        <div className="flex items-start gap-2 text-sm text-tx-primary rounded-lg p-3 mb-3" style={{ background: `${accent}12` }}>
          <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }} />
          <span>{adherence.motivational_note}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        {adherence.should_regenerate ? (
          <Link to="/weight/plan" className="text-xs text-amber-400 hover:text-amber-300 inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Time to refresh your plan
          </Link>
        ) : <span />}
        <Link to="/weight/plan" className="text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-0.5">
          View plan <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}

function SubStat({ icon: Icon, color, value, label }: {
  icon: typeof Utensils; color: string; value: string | number; label: string
}) {
  return (
    <div className="rounded-lg bg-surface-overlay/60 p-2.5 text-center">
      <Icon className="w-3.5 h-3.5 mx-auto mb-1" style={{ color }} />
      <p className="stat-value text-lg">{value}</p>
      <p className="text-[10px] text-tx-muted">{label}</p>
    </div>
  )
}
