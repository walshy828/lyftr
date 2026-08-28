// Pure, framework-free logic for the Weekly Summary page: buckets the
// existing daily/weekly series (training, cardio, nutrition, weight, plan)
// into N consecutive Mon-start weeks. Mirrors dashboardMetrics.ts's
// "this week" math, generalized from one comparison to a run of weeks.

import type {
  TrainingDay, CardioDay, FoodHistoryPoint, WeightLog, WeightPlanHistoryWeek,
} from '../types'
import { weekRange, weeklyNutrition, delta, type WeekRange, type WeeklyNutrition, type Delta } from './dashboardMetrics'

// ── Week windows ──────────────────────────────────────────────────────────

/** `count` consecutive Mon-start weeks ending at the week containing `now`, oldest first. */
export function weeksBack(now: Date, count: number): WeekRange[] {
  const out: WeekRange[] = []
  for (let i = count - 1; i >= 0; i--) out.push(weekRange(now, i))
  return out
}

const dayStr = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ── Weight: carried-forward "as of" reading ─────────────────────────────
//
// Weight isn't logged daily, so a week's start/end weight is "the most
// recent reading on or before this date", not "a reading that happened to
// fall inside the week" — otherwise a week with no new log would wrongly
// read as "no data" even though the user's weight obviously didn't reset.
// `logs` must be sorted ascending by date for this to be a simple scan.
function asOfWeight(sortedLogs: { date: string; weight: number }[], targetDate: string): number | null {
  let result: number | null = null
  for (const l of sortedLogs) {
    if (l.date > targetDate) break
    result = l.weight
  }
  return result
}

export interface WeeklyWeight {
  start: number | null
  end: number | null
  change: number | null
}

// ── Strength / cardio sums over a week ──────────────────────────────────
export interface WeeklyStrength {
  workouts: number
  duration: number
  volume: number
  sets: number
}
export interface WeeklyCardioTotals {
  sessions: number
  duration: number
  distanceMeters: number
}

function sumInRange<T extends { date: string }>(days: T[], range: WeekRange): T[] {
  const lo = dayStr(range.start)
  const hi = dayStr(range.end)
  return days.filter(d => d.date >= lo && d.date <= hi)
}

// ── Plan comparison (target vs actual weight) ────────────────────────────
export interface WeeklyPlan {
  target: number
  actual: number
  hasActual: boolean
  varianceLbs: number
}

// Plan-history weeks are bucketed from the plan's acceptance date, not from
// the calendar Monday — so they rarely land on the exact same date as a
// summary week. A few days' tolerance pairs each summary week with the plan
// bucket that actually covers it, the same slack the backend itself uses
// (see buildHistoryWeeks's ±3 day nearestLogWeight tolerance).
function findPlanWeek(planWeeks: WeightPlanHistoryWeek[], weekStart: Date, toleranceDays = 3): WeightPlanHistoryWeek | null {
  const target = weekStart.getTime()
  let best: WeightPlanHistoryWeek | null = null
  let bestDiff = Infinity
  for (const w of planWeeks) {
    const diff = Math.abs(new Date(w.week_start).getTime() - target)
    if (diff < bestDiff) { bestDiff = diff; best = w }
  }
  return best && bestDiff <= toleranceDays * 86_400_000 ? best : null
}

export interface WeeklySummaryRow {
  range: WeekRange
  weight: WeeklyWeight
  strength: WeeklyStrength
  cardio: WeeklyCardioTotals
  nutrition: WeeklyNutrition
  plan: WeeklyPlan | null
}

/**
 * Buckets every daily/weekly source series into `weeks`. `weightLogs` should
 * cover a bit before the first week (the caller widens the fetch window) so
 * the very first week has a carried-forward starting weight where possible.
 */
export function buildWeeklySummary(
  weeks: WeekRange[],
  dailyTraining: TrainingDay[],
  dailyCardio: CardioDay[],
  foodHistory: FoodHistoryPoint[],
  weightLogs: WeightLog[],
  proteinTarget: number,
  now: Date,
  planWeeks?: WeightPlanHistoryWeek[],
): WeeklySummaryRow[] {
  const sortedWeights = weightLogs
    .map(l => ({ date: dayStr(new Date(l.logged_at)), weight: l.weight }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return weeks.map(range => {
    const trainingDays = sumInRange(dailyTraining, range)
    const cardioDays = sumInRange(dailyCardio, range)

    const strength: WeeklyStrength = trainingDays.reduce(
      (acc, d) => ({
        workouts: acc.workouts + d.workouts,
        duration: acc.duration + d.duration,
        volume: acc.volume + d.volume,
        sets: acc.sets + d.sets,
      }),
      { workouts: 0, duration: 0, volume: 0, sets: 0 },
    )

    const cardio: WeeklyCardioTotals = cardioDays.reduce(
      (acc, d) => ({
        sessions: acc.sessions + d.sessions,
        duration: acc.duration + d.duration,
        distanceMeters: acc.distanceMeters + d.distance_meters,
      }),
      { sessions: 0, duration: 0, distanceMeters: 0 },
    )

    const startW = asOfWeight(sortedWeights, dayStr(range.start))
    const endW = asOfWeight(sortedWeights, dayStr(range.end))
    const weight: WeeklyWeight = {
      start: startW,
      end: endW,
      change: startW !== null && endW !== null ? endW - startW : null,
    }

    const nutrition = weeklyNutrition(foodHistory, proteinTarget, range, now)

    let plan: WeeklyPlan | null = null
    if (planWeeks?.length) {
      const match = findPlanWeek(planWeeks, range.start)
      if (match && match.goal_id !== 0) {
        plan = {
          target: match.target_weight,
          actual: match.actual_weight,
          hasActual: match.has_actual,
          varianceLbs: match.variance_lbs,
        }
      }
    }

    return { range, weight, strength, cardio, nutrition, plan }
  })
}

// ── Week-over-week deltas for the table ──────────────────────────────────
export interface WeeklyDeltas {
  workouts: Delta
  cardioSessions: Delta
  avgCalories: Delta
  avgProtein: Delta
}
export function weekOverWeek(rows: WeeklySummaryRow[]): (WeeklyDeltas | null)[] {
  return rows.map((row, i) => {
    if (i === 0) return null
    const prev = rows[i - 1]
    return {
      workouts: delta(row.strength.workouts, prev.strength.workouts),
      cardioSessions: delta(row.cardio.sessions, prev.cardio.sessions),
      avgCalories: delta(Math.round(row.nutrition.avgCalories), Math.round(prev.nutrition.avgCalories)),
      avgProtein: delta(Math.round(row.nutrition.avgProtein), Math.round(prev.nutrition.avgProtein)),
    }
  })
}

// ── Waterfall series: cumulative weight change since the period start ────
//
// Absolute weight isn't a natural waterfall base (an artificial zero would
// swamp a few pounds of weekly change against ~180lbs of baseline) — so this
// re-bases to "net change since the first week with a known starting
// weight," a true bridge chart: each bar floats from the running total
// before that week to the running total after it.
export interface WaterfallBar {
  weekStart: string
  /** null when the week has no weight data at all (gap in the bars). */
  base: number | null
  delta: number | null
  cumulative: number | null
}
export function weightWaterfall(rows: WeeklySummaryRow[]): WaterfallBar[] {
  let cumulative = 0
  let started = false
  return rows.map(row => {
    const weekStart = dayStr(row.range.start)
    if (row.weight.change === null) {
      return { weekStart, base: started ? cumulative : null, delta: null, cumulative: started ? cumulative : null }
    }
    const base = cumulative
    cumulative += row.weight.change
    started = true
    return { weekStart, base, delta: row.weight.change, cumulative }
  })
}
