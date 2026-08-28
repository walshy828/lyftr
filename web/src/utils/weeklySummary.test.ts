import { describe, it, expect } from 'vitest'
import { weeksBack, buildWeeklySummary, weekOverWeek, weightWaterfall } from './weeklySummary'
import type { TrainingDay, CardioDay, FoodHistoryPoint, WeightLog, WeightPlanHistoryWeek } from '../types'

// Wednesday, 2026-07-15 — mid-week reference, matches dashboardMetrics.test.ts.
const NOW = new Date(2026, 6, 15, 12, 0, 0)

function weightLog(date: string, weight: number): WeightLog {
  return { id: Math.random(), weight, logged_at: `${date}T08:00:00` }
}

describe('weeksBack', () => {
  it('returns N consecutive Mon-start weeks, oldest first, ending at the current week', () => {
    const weeks = weeksBack(NOW, 3)
    expect(weeks).toHaveLength(3)
    // Each week starts 7 days after the previous.
    expect(weeks[1].start.getTime() - weeks[0].start.getTime()).toBe(7 * 86_400_000)
    expect(weeks[2].start.getTime() - weeks[1].start.getTime()).toBe(7 * 86_400_000)
    // Last week contains NOW.
    expect(weeks[2].start.getTime()).toBeLessThanOrEqual(NOW.getTime())
    expect(weeks[2].end.getTime()).toBeGreaterThanOrEqual(NOW.getTime())
  })
})

describe('buildWeeklySummary', () => {
  const weeks = weeksBack(NOW, 2) // week0: Jul 6–12, week1: Jul 13–19
  const training: TrainingDay[] = [
    { date: '2026-07-07', workouts: 1, duration: 3600, volume: 5000, sets: 15, exercises: 4 },
    { date: '2026-07-14', workouts: 1, duration: 1800, volume: 2000, sets: 8, exercises: 2 },
  ]
  const cardio: CardioDay[] = [
    { date: '2026-07-08', sessions: 1, duration: 1800, distance_meters: 5000, calories: 300 },
  ]
  const food: FoodHistoryPoint[] = [
    { date: '2026-07-07', calories: 2000, protein: 150, carbs: 200, fat: 60 },
    { date: '2026-07-08', calories: 2100, protein: 140, carbs: 210, fat: 65 },
  ]

  it('sums training and cardio into the correct week bucket', () => {
    const rows = buildWeeklySummary(weeks, training, cardio, food, [], 150, NOW)
    expect(rows[0].strength.workouts).toBe(1)
    expect(rows[0].strength.volume).toBe(5000)
    expect(rows[0].cardio.sessions).toBe(1)
    expect(rows[0].cardio.distanceMeters).toBe(5000)
    expect(rows[1].strength.workouts).toBe(1)
    expect(rows[1].strength.volume).toBe(2000)
    expect(rows[1].cardio.sessions).toBe(0)
  })

  it('carries the last known weight forward into weeks with no new log', () => {
    const logs = [weightLog('2026-07-06', 200), weightLog('2026-07-09', 198)]
    const rows = buildWeeklySummary(weeks, training, cardio, food, logs, 150, NOW)
    // Week 0 (Jul 6-12): starts at the Jul 6 log, ends at the Jul 9 log.
    expect(rows[0].weight.start).toBe(200)
    expect(rows[0].weight.end).toBe(198)
    expect(rows[0].weight.change).toBeCloseTo(-2)
    // Week 1 (Jul 13-19) has no new log — carries the last known reading forward.
    expect(rows[1].weight.start).toBe(198)
    expect(rows[1].weight.end).toBe(198)
    expect(rows[1].weight.change).toBeCloseTo(0)
  })

  it('reports null weight change when there is no prior reading at all', () => {
    const rows = buildWeeklySummary(weeks, training, cardio, food, [], 150, NOW)
    expect(rows[0].weight.change).toBeNull()
  })

  it('matches the nearest plan-history week within tolerance', () => {
    const planWeeks: WeightPlanHistoryWeek[] = [
      { week_start: '2026-07-05', week: 0, target_weight: 199, actual_weight: 200, has_actual: true, goal_id: 1, variance_lbs: 1 },
    ]
    const rows = buildWeeklySummary(weeks, training, cardio, food, [], 150, NOW, planWeeks)
    expect(rows[0].plan).not.toBeNull()
    expect(rows[0].plan?.target).toBe(199)
    expect(rows[1].plan).toBeNull() // Jul 13 is > 3 days from Jul 5
  })
})

describe('weekOverWeek', () => {
  it('is null for the first row and a real delta for the rest', () => {
    const weeks = weeksBack(NOW, 2)
    const rows = buildWeeklySummary(
      weeks,
      [{ date: '2026-07-07', workouts: 1, duration: 100, volume: 100, sets: 5, exercises: 1 }],
      [],
      [],
      [],
      150,
      NOW,
    )
    const deltas = weekOverWeek(rows)
    expect(deltas[0]).toBeNull()
    expect(deltas[1]?.workouts.abs).toBe(-1)
  })
})

describe('weightWaterfall', () => {
  it('accumulates week-over-week weight change from a zero baseline', () => {
    const weeks = weeksBack(NOW, 3)
    // Deliberately NOT aligned to Monday week-boundaries, so each week's
    // start/end resolve to different readings rather than all landing on
    // the same boundary log.
    const logs = [weightLog('2026-06-24', 200), weightLog('2026-07-02', 198), weightLog('2026-07-09', 199), weightLog('2026-07-14', 197)]
    const rows = buildWeeklySummary(weeks, [], [], [], logs, 150, NOW)
    const bars = weightWaterfall(rows)
    // week0: 200 -> 198 (delta -2, cumulative -2)
    expect(bars[0].delta).toBeCloseTo(-2)
    expect(bars[0].cumulative).toBeCloseTo(-2)
    // week1: 198 -> 199 (delta +1, cumulative -1)
    expect(bars[1].delta).toBeCloseTo(1)
    expect(bars[1].cumulative).toBeCloseTo(-1)
    // week2: 199 -> 197 (delta -2, cumulative -3)
    expect(bars[2].delta).toBeCloseTo(-2)
    expect(bars[2].cumulative).toBeCloseTo(-3)
  })

  it('leaves a gap (null delta) for weeks with no weight data at all', () => {
    const weeks = weeksBack(NOW, 2)
    const rows = buildWeeklySummary(weeks, [], [], [], [], 150, NOW)
    const bars = weightWaterfall(rows)
    expect(bars[0].delta).toBeNull()
    expect(bars[1].delta).toBeNull()
  })
})
