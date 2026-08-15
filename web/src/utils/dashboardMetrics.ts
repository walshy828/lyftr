// Pure, framework-free metric helpers for the home dashboard. Kept out of the
// components so the weekly / week-over-week / insight math is unit-testable.

import { startOfWeek, endOfWeek, subWeeks } from 'date-fns'
import type { Workout, FoodHistoryPoint, WeightLog, CardioSession } from '../types'
import { focusOf, type FocusCategory, type ActivityCategory } from './chartTheme'

// ── Volume ──────────────────────────────────────────────────────────────
export const calcVolume = (w: Pick<Workout, 'exercises'>): number =>
  (w.exercises ?? []).reduce(
    (s, ex) => s + (ex.sets ?? []).reduce((ss, set) => ss + (set.reps || 0) * (set.weight || 0), 0),
    0,
  )

// ── Week windows (Mon-start, matching the rest of the app) ──────────────
export interface WeekRange { start: Date; end: Date }
export function weekRange(now: Date, weeksAgo = 0): WeekRange {
  const ref = subWeeks(now, weeksAgo)
  return { start: startOfWeek(ref, { weekStartsOn: 1 }), end: endOfWeek(ref, { weekStartsOn: 1 }) }
}

// How many days of `range` have actually happened as of `now`: 7 for any
// completed week, 1–7 for the week in progress. This is the honest denominator
// for every "x of y days" stat — on a Wednesday only three days exist to log,
// so scoring them out of 7 reads as a failure the user hasn't had a chance to
// avoid.
export function elapsedDays(range: WeekRange, now: Date): number {
  // Counted in calendar days, not milliseconds: a week containing a DST shift
  // is 167 or 169 hours long, which a /86_400_000 division rounds wrong.
  const spanDays = dayIndex(range.end) - dayIndex(range.start) + 1
  if (now >= range.end) return spanDays
  if (now < range.start) return 0
  return Math.min(spanDays, dayIndex(now) - dayIndex(range.start) + 1)
}

// Days since the epoch for a date's LOCAL calendar day — a DST-safe way to
// subtract two dates and get a whole number of days.
const dayIndex = (d: Date): number =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)

// The first `days` days of a week, as its own range — used to compare the
// in-progress week against the SAME slice of the prior week. Comparing three
// days against a full seven makes every week look like a collapse on Monday.
export function firstDaysOf(range: WeekRange, days: number): WeekRange {
  const end = new Date(range.start)
  end.setDate(end.getDate() + Math.max(days, 1) - 1)
  end.setHours(23, 59, 59, 999)
  return { start: range.start, end: end < range.end ? end : range.end }
}

// ── Training ────────────────────────────────────────────────────────────
export interface WeeklyTraining { sessions: number; volume: number }
export function weeklyTraining(workouts: Workout[], range: WeekRange): WeeklyTraining {
  let sessions = 0
  let volume = 0
  for (const w of workouts) {
    const t = new Date(w.started_at)
    if (t >= range.start && t <= range.end) {
      sessions += 1
      volume += calcVolume(w)
    }
  }
  return { sessions, volume }
}

// ── Cardio (synced from Health Connect) ──────────────────────────────────
export interface WeeklyCardio { sessions: number; duration: number }
export function weeklyCardio(sessions: CardioSession[], range: WeekRange): WeeklyCardio {
  let count = 0
  let duration = 0
  for (const s of sessions) {
    const t = new Date(s.started_at)
    if (t >= range.start && t <= range.end) {
      count += 1
      duration += s.duration_seconds
    }
  }
  return { sessions: count, duration }
}

// Whole days since the most recent workout (0 = worked out today). null when
// there are no workouts at all.
export function daysSinceLastWorkout(workouts: Workout[], now: Date): number | null {
  let latest = -Infinity
  for (const w of workouts) latest = Math.max(latest, new Date(w.started_at).getTime())
  if (!isFinite(latest)) return null
  return Math.floor((now.getTime() - latest) / 86_400_000)
}

// Focus regions NOT trained within `days` (used to flag neglected areas).
export function untrainedFocusRegions(
  workouts: Workout[], now: Date, days = 14,
): FocusCategory[] {
  const cutoff = now.getTime() - days * 86_400_000
  const trained = new Set<FocusCategory>()
  for (const w of workouts) {
    if (new Date(w.started_at).getTime() < cutoff) continue
    for (const ex of w.exercises ?? []) {
      const f = focusOf(ex.exercise?.muscle_group ?? '')
      if (f) trained.add(f)
    }
  }
  // Only flag the three real training regions — "Full Body" isn't a gap.
  return (['Upper', 'Lower', 'Core'] as FocusCategory[]).filter(f => !trained.has(f))
}

// ── Activity mix (time spent per category) ──────────────────────────────
// Attribute a workout's wall-clock duration across activity categories,
// proportional to each category's share of logged sets. Cardio exercises
// (category === 'cardio') map to 'Cardio'; strength exercises map to their
// focus region via focusOf. A cardio effort is a single time+distance entry,
// so its lone set still gets its full share. Returns minutes (may be
// fractional); categories with no sets are simply absent from the map.
export function workoutMinutesByCategory(w: Pick<Workout, 'exercises' | 'duration'>): Map<ActivityCategory, number> {
  const setShare = new Map<ActivityCategory, number>()
  let totalSets = 0
  for (const ex of w.exercises ?? []) {
    const isCardio = ex.exercise?.category === 'cardio'
    const cat: ActivityCategory | null = isCardio ? 'Cardio' : focusOf(ex.exercise?.muscle_group ?? '')
    if (!cat) continue
    const n = (ex.sets ?? []).length
    if (n === 0) continue
    setShare.set(cat, (setShare.get(cat) || 0) + n)
    totalSets += n
  }
  const minutes = new Map<ActivityCategory, number>()
  if (totalSets === 0) return minutes
  const durationMin = (w.duration || 0) / 60
  setShare.forEach((n, cat) => minutes.set(cat, (n / totalSets) * durationMin))
  return minutes
}

// Sum activity minutes across many workouts into a single per-category map.
export function activityMix(workouts: Pick<Workout, 'exercises' | 'duration'>[]): Map<ActivityCategory, number> {
  const acc = new Map<ActivityCategory, number>()
  for (const w of workouts) {
    workoutMinutesByCategory(w).forEach((m, cat) => acc.set(cat, (acc.get(cat) || 0) + m))
  }
  return acc
}

// ── Nutrition (from the per-day history series) ─────────────────────────
export interface WeeklyNutrition {
  avgCalories: number      // mean over LOGGED days (0 when none logged)
  avgProtein: number
  avgCarbs: number
  avgFat: number
  daysLogged: number       // days in-window with any calories
  daysInWindow: number     // days of the window that have elapsed (the denominator)
  proteinHitDays: number   // logged days that met the protein target
}

// ISO 'YYYY-MM-DD' strings sort lexicographically, so range checks are TZ-free.
const dayStr = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// `now` decides how much of `range` counts as elapsed — pass the same clock the
// caller used to build the range so an in-progress week is scored out of the
// days it actually has.
export function weeklyNutrition(
  history: FoodHistoryPoint[], proteinTarget: number, range: WeekRange, now: Date = new Date(),
): WeeklyNutrition {
  const lo = dayStr(range.start)
  const hi = dayStr(range.end)
  const logged = history.filter(p => p.date >= lo && p.date <= hi && p.calories > 0)
  const n = logged.length
  const sum = (sel: (p: FoodHistoryPoint) => number) => logged.reduce((s, p) => s + sel(p), 0)
  return {
    avgCalories: n ? sum(p => p.calories) / n : 0,
    avgProtein: n ? sum(p => p.protein) / n : 0,
    avgCarbs: n ? sum(p => p.carbs) / n : 0,
    avgFat: n ? sum(p => p.fat) / n : 0,
    daysLogged: n,
    daysInWindow: elapsedDays(range, now),
    proteinHitDays: proteinTarget > 0 ? logged.filter(p => p.protein >= proteinTarget).length : 0,
  }
}

// ── Week-over-week delta ────────────────────────────────────────────────
export interface Delta { abs: number; pct: number | null }
export function delta(current: number, prior: number): Delta {
  return { abs: current - prior, pct: prior > 0 ? Math.round(((current - prior) / prior) * 100) : null }
}

// ── Weight trend (client-side OLS, for the no-plan case where the server's
// actual_forecast isn't available) ─────────────────────────────────────
export interface TrendPoint { ts: number; weight: number }
export function weightSeries(logs: WeightLog[]): TrendPoint[] {
  return logs
    .map(l => ({ ts: new Date(l.logged_at).getTime(), weight: l.weight }))
    .sort((a, b) => a.ts - b.ts)
}

// Ordinary-least-squares fit y = intercept + slope*ts. Returns the fitted
// value at the first and last point, or null with < 2 distinct points.
export interface TrendLine { firstTs: number; lastTs: number; firstVal: number; lastVal: number; slopePerDay: number }
export function olsTrend(points: TrendPoint[]): TrendLine | null {
  if (points.length < 2) return null
  const n = points.length
  const mx = points.reduce((s, p) => s + p.ts, 0) / n
  const my = points.reduce((s, p) => s + p.weight, 0) / n
  let num = 0, den = 0
  for (const p of points) { num += (p.ts - mx) * (p.weight - my); den += (p.ts - mx) ** 2 }
  if (den === 0) return null
  const slope = num / den
  const intercept = my - slope * mx
  const firstTs = points[0].ts
  const lastTs = points[n - 1].ts
  return {
    firstTs, lastTs,
    firstVal: intercept + slope * firstTs,
    lastVal: intercept + slope * lastTs,
    slopePerDay: slope * 86_400_000,
  }
}

// ── Goal direction (needs an active plan's target vs a starting weight) ──
export type GoalDirection = 'loss' | 'gain' | 'maintain'
export function goalDirection(targetWeightLbs: number, startingLbs: number): GoalDirection {
  const d = targetWeightLbs - startingLbs
  if (d < -1) return 'loss'
  if (d > 1) return 'gain'
  return 'maintain'
}

// Fraction [0..1] of the way from starting weight to target.
export function goalProgress(startingLbs: number, latestLbs: number, targetLbs: number): number {
  const total = targetLbs - startingLbs
  if (Math.abs(total) < 0.01) return latestLbs === targetLbs ? 1 : 0
  return Math.max(0, Math.min(1, (latestLbs - startingLbs) / total))
}

// ── Insights ────────────────────────────────────────────────────────────
export interface Insight { tone: 'good' | 'focus'; text: string }

export interface InsightSignals {
  nutrition: WeeklyNutrition
  calorieTarget: number
  sessionsThisWeek: number
  daysSinceWorkout: number | null
  untrainedRegions: FocusCategory[]
  weightChange7d: number     // display-unit delta over 7d (negative = down)
  weightUnit: string
  goal: GoalDirection | null // null when no active plan
}

// Rule-based, pragmatic + motivational. Caps at 2 "good" + 2 "focus", chosen in
// priority order so the most meaningful signal surfaces first.
export function buildInsights(s: InsightSignals): Insight[] {
  const good: Insight[] = []
  const focus: Insight[] = []
  const u = s.weightUnit

  // Consistency is judged against the days of the week that have elapsed, not a
  // flat 7 — otherwise a perfectly-logged Wednesday reads "3 of 7 days tracked"
  // and lands in "focus". The thresholds are expressed as days MISSED so they
  // keep their full-week meaning (missed <=1 = consistent, >=4 = slipped) while
  // staying honest mid-week: early in the week there simply aren't enough days
  // for either verdict yet, so neither fires.
  const days = s.nutrition.daysInWindow
  const missedLogging = days - s.nutrition.daysLogged
  const missedProtein = days - s.nutrition.proteinHitDays

  // A "streak" claim needs a few days behind it, hence the days >= 3 floor —
  // one logged Monday isn't consistency yet.
  const enoughSignal = days >= 3

  // Good
  if (enoughSignal && s.nutrition.proteinHitDays > 0 && missedProtein <= 2)
    good.push({ tone: 'good', text: `Protein on point — hit target ${s.nutrition.proteinHitDays} of ${days} days` })
  if (enoughSignal && s.nutrition.daysLogged > 0 && missedLogging <= 1)
    good.push({ tone: 'good', text: `Consistent logging — tracked food ${s.nutrition.daysLogged} of ${days} days` })
  if (s.sessionsThisWeek >= 3)
    good.push({ tone: 'good', text: `Strong week — ${s.sessionsThisWeek} training sessions logged` })
  if (s.goal === 'loss' && s.weightChange7d < -0.1)
    good.push({ tone: 'good', text: `Weight trending toward goal — down ${Math.abs(s.weightChange7d).toFixed(1)} ${u} this week` })
  if (s.goal && s.nutrition.daysLogged > 0 && Math.abs(s.nutrition.avgCalories - s.calorieTarget) <= 100)
    good.push({ tone: 'good', text: `Calories dialed in — averaging within ${s.calorieTarget} kcal target` })

  // Focus
  if (s.nutrition.daysLogged > 0 && missedLogging >= 4)
    focus.push({ tone: 'focus', text: `Logging slipped — only ${s.nutrition.daysLogged} of ${days} days tracked` })
  if (s.nutrition.daysLogged > 0 && s.nutrition.avgCalories - s.calorieTarget > 150)
    focus.push({ tone: 'focus', text: `Averaging ${Math.round(s.nutrition.avgCalories - s.calorieTarget)} kcal over target` })
  if (s.daysSinceWorkout !== null && s.daysSinceWorkout >= 7)
    focus.push({ tone: 'focus', text: `No workouts in the last ${s.daysSinceWorkout} days` })
  if (s.untrainedRegions.includes('Lower'))
    focus.push({ tone: 'focus', text: `Haven't trained legs in 2+ weeks` })
  if (s.goal === 'loss' && s.weightChange7d > 0.3)
    focus.push({ tone: 'focus', text: `Weight ticked up ${s.weightChange7d.toFixed(1)} ${u} this week` })

  return [...good.slice(0, 2), ...focus.slice(0, 2)]
}
