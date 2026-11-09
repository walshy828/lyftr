/**
 * Plan Pulse: "am I on pace, and should I change the plan or just stick to it?"
 *
 * The distinction this module exists for: being behind plan is only a reason to
 * change the plan when you are actually following it. Behind with patchy
 * logging, or with calories over target, means the plan was never really
 * tested; changing it then just moves the goalposts. So the verdict looks at
 * pace AND adherence together, and says when to look again if it's too early.
 *
 * Everything is in canonical lbs; callers convert for display. Pure so it can
 * be tested against a fixed clock.
 */
import type { CurrentNutritionGoal, FoodHistoryPoint, WeightLog, WeightPlanAdherence } from '../types'
import { olsTrend } from './dashboardMetrics'

const DAY = 86_400_000
/** Window for the smoothed "trend weight" and the recent pace. */
export const TREND_WINDOW_DAYS = 21
/** Window for judging adherence (logging consistency, calories). */
export const ADHERENCE_WINDOW_DAYS = 14
/** A plan younger than this hasn't had time to show a trend through water noise. */
const MIN_PLAN_DAYS = 14
const MIN_WEIGH_INS = 4

export type PlanVerdict =
  | 'goal-reached'
  | 'too-early'
  | 'on-track'
  | 'ahead-too-fast'
  | 'fix-logging'
  | 'fix-calories'
  | 'adjust-plan'

export interface PlanPulse {
  verdict: PlanVerdict
  tone: 'good' | 'neutral' | 'focus' | 'act'
  headline: string
  detail: string
  /** When to look at this again, for verdicts that are really "wait and see". */
  recheckOn: Date | null
  cta: { label: string; to: string } | null

  weekOfPlan: number
  totalWeeks: number
  direction: 'loss' | 'gain'
  /** Smoothed current weight (OLS fit at today over the trend window). */
  trendNow: number | null
  /** Where the plan says you should be today. */
  expectedNow: number | null
  /** trendNow vs expectedNow, signed so positive = behind plan. */
  behindBy: number | null
  /** Recent pace in lbs/week toward the goal (positive = moving the right way). */
  recentRate: number | null
  /** The plan's own pace in lbs/week toward the goal. */
  planRate: number | null
  target: number
  plannedGoalDate: Date | null
  /** When the recent pace reaches the target, if it ever does. */
  projectedGoalDate: Date | null
  loggedDays: number
  avgCalories: number
  calorieTarget: number
}

export interface PlanPulseInput {
  now: Date
  plan: CurrentNutritionGoal
  weightLogs: WeightLog[]
  foodHistory: FoodHistoryPoint[]
  adherence: WeightPlanAdherence | null
}

interface DatedPoint { t: number; w: number }

/** Projection points with real dates (falling back to effective_at + week*7). */
function planPoints(plan: CurrentNutritionGoal): DatedPoint[] {
  const start = new Date(plan.goal.effective_at).getTime()
  const src = plan.projections?.length ? plan.projections : plan.plan_timeline ?? []
  return src
    .map(p => ({
      t: p.expected_date ? new Date(p.expected_date).getTime() : start + p.week * 7 * DAY,
      w: p.expected_weight,
    }))
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
}

/** Linear interpolation of the plan line at time t (clamped to its ends). */
export function expectedAt(points: DatedPoint[], t: number): number | null {
  if (points.length === 0) return null
  if (t <= points[0].t) return points[0].w
  const last = points[points.length - 1]
  if (t >= last.t) return last.w
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if (t <= b.t) return a.w + ((b.w - a.w) * (t - a.t)) / (b.t - a.t || 1)
  }
  return last.w
}

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function buildPlanPulse({ now, plan, weightLogs, foodHistory, adherence }: PlanPulseInput): PlanPulse {
  const t = now.getTime()
  const target = plan.goal.target_weight
  const calorieTarget = plan.goal.calorie_target
  const pts = planPoints(plan)
  const effective = new Date(plan.goal.effective_at).getTime()
  const planDays = Math.max(0, (t - effective) / DAY)
  const totalWeeks = pts.length ? Math.max(1, Math.round((pts[pts.length - 1].t - effective) / (7 * DAY))) : 0
  const weekOfPlan = Math.min(totalWeeks || Infinity, Math.floor(planDays / 7) + 1)
  const plannedGoalDate = pts.length ? new Date(pts[pts.length - 1].t) : null

  const startW = pts[0]?.w ?? weightLogs[weightLogs.length - 1]?.weight ?? target
  const direction: 'loss' | 'gain' = target > startW ? 'gain' : 'loss'
  const sign = direction === 'loss' ? 1 : -1 // converts "lbs down" into "lbs toward goal"

  // Trend weight + recent pace from the last few weeks of weigh-ins.
  const recent = weightLogs
    .map(l => ({ ts: new Date(l.logged_at).getTime(), weight: l.weight }))
    .filter(p => p.ts >= t - TREND_WINDOW_DAYS * DAY && p.ts <= t)
    .sort((a, b) => a.ts - b.ts)
  const fit = recent.length >= 2 ? olsTrend(recent) : null
  const trendNow = fit ? fit.lastVal + (fit.slopePerDay * (t - fit.lastTs)) / DAY : recent[recent.length - 1]?.weight ?? null
  const recentRate = fit ? -fit.slopePerDay * 7 * sign : null

  const expectedNow = expectedAt(pts, t)
  const behindBy = trendNow !== null && expectedNow !== null ? (trendNow - expectedNow) * sign : null

  const planRate = pts.length >= 2
    ? ((pts[0].w - pts[pts.length - 1].w) * sign) / Math.max(1, (pts[pts.length - 1].t - pts[0].t) / (7 * DAY))
    : null

  const remaining = trendNow !== null ? (trendNow - target) * sign : null
  const projectedGoalDate = remaining !== null && recentRate !== null && recentRate > 0.05 && remaining > 0
    ? new Date(t + (remaining / recentRate) * 7 * DAY)
    : null

  // Adherence over the last two weeks, from the food history the app already loads.
  const since = t - ADHERENCE_WINDOW_DAYS * DAY
  const logged = foodHistory.filter(d => d.calories > 0 && new Date(d.date + 'T12:00:00').getTime() >= since)
  const loggedDays = logged.length
  const avgCalories = loggedDays ? logged.reduce((s, d) => s + d.calories, 0) / loggedDays : 0

  const base = {
    weekOfPlan, totalWeeks, direction, trendNow, expectedNow, behindBy, recentRate, planRate, target,
    plannedGoalDate, projectedGoalDate, loggedDays, avgCalories, calorieTarget,
  }
  const reviewPlan = { label: 'Review plan', to: '/weight/plan' }
  const checkin = { label: 'Run a check-in', to: '/weight/checkin' }

  // 1. Done.
  if (remaining !== null && remaining <= 0) {
    return { ...base, verdict: 'goal-reached', tone: 'good', headline: 'Goal reached',
      detail: 'Your trend weight is at your target. Set a maintenance or new goal so the targets keep fitting.',
      recheckOn: null, cta: { label: 'Set next goal', to: '/weight/plan' } }
  }

  // 2. Not enough signal yet — say exactly when there will be.
  if (planDays < MIN_PLAN_DAYS || recent.length < MIN_WEIGH_INS || fit === null) {
    const byPlanAge = effective + MIN_PLAN_DAYS * DAY
    const byWeighIns = t + Math.max(0, MIN_WEIGH_INS - recent.length) * 2 * DAY
    const recheckOn = new Date(Math.max(byPlanAge, byWeighIns, t + DAY))
    const why = recent.length < MIN_WEIGH_INS
      ? `Weigh in a few more times (${recent.length} in the last 3 weeks) so the trend means something.`
      : 'Early weeks are mostly water and glycogen — the real trend needs two weeks to show.'
    return { ...base, verdict: 'too-early', tone: 'neutral', headline: 'Too early to judge',
      detail: `${why} Re-check ${fmtDay(recheckOn)}.`, recheckOn, cta: null }
  }

  const behind = behindBy !== null && behindBy > 1 && (planRate === null || recentRate === null || recentRate < planRate * 0.8)

  // 3. Faster than planned by a lot — worth easing off to protect muscle.
  if (direction === 'loss' && planRate && recentRate !== null && trendNow
      && recentRate > Math.max(planRate * 1.5, 0.5) && recentRate > trendNow * 0.01) {
    return { ...base, verdict: 'ahead-too-fast', tone: 'focus', headline: 'Losing faster than planned',
      detail: `${recentRate.toFixed(1)} lb/week is over 1% of body weight. Fine for a week; sustained, it costs muscle. Consider eating closer to ${calorieTarget} kcal.`,
      recheckOn: null, cta: reviewPlan }
  }

  // 4. On pace.
  if (!behind) {
    const ahead = behindBy !== null && behindBy < -0.5
    return { ...base, verdict: 'on-track', tone: 'good',
      headline: ahead ? 'Ahead of plan' : 'On track',
      detail: loggedDays >= 10
        ? 'Pace and logging are both where they need to be. Keep doing exactly this.'
        : 'Weight is on pace. Keep logging so a slip shows up early.',
      recheckOn: null, cta: null }
  }

  // 5. Behind — but is the plan being followed?
  const recheckOn = new Date(t + ADHERENCE_WINDOW_DAYS * DAY)
  if (loggedDays < 10) {
    return { ...base, verdict: 'fix-logging', tone: 'focus', headline: 'Behind — but the data is thin',
      detail: `Food logged ${loggedDays} of the last ${ADHERENCE_WINDOW_DAYS} days. Changing the plan now would be guessing; log every day for two weeks, then re-check ${fmtDay(recheckOn)}.`,
      recheckOn, cta: { label: 'Log food', to: '/food' } }
  }
  if (avgCalories > calorieTarget + 150) {
    return { ...base, verdict: 'fix-calories', tone: 'focus', headline: 'Behind — calories are over',
      detail: `Averaging ${Math.round(avgCalories)} kcal against ${calorieTarget}. The plan hasn't been tested yet: hit the target for two weeks before changing it (re-check ${fmtDay(recheckOn)}).`,
      recheckOn, cta: { label: 'See food trend', to: '/stats?tab=nutrition' } }
  }

  // 6. Following it and still behind: this is the real "change the plan" signal.
  const reasons = [
    `logging ${loggedDays}/${ADHERENCE_WINDOW_DAYS} days`,
    `averaging ${Math.round(avgCalories)} kcal (target ${calorieTarget})`,
  ]
  if (adherence?.should_regenerate && adherence.regenerate_reason) reasons.push(adherence.regenerate_reason)
  return { ...base, verdict: 'adjust-plan', tone: 'act', headline: 'Time to adjust the plan',
    detail: `You're following it — ${reasons.join(', ')} — and still ${behindBy!.toFixed(1)} lb behind. Your real maintenance is likely lower than estimated: lower calories ~150–200, add activity, or extend the timeline.`,
    recheckOn: null, cta: adherence?.should_regenerate ? reviewPlan : checkin }
}
