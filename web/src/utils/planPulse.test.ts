import { describe, it, expect } from 'vitest'
import { buildPlanPulse, expectedAt } from './planPulse'
import type { CurrentNutritionGoal, FoodHistoryPoint, WeightLog } from '../types'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 9, 9)

/** A 16-week plan from 200 → 184 lb (1 lb/week) that started `weeksAgo` weeks ago. */
function plan(weeksAgo: number, calorieTarget = 2000): CurrentNutritionGoal {
  const start = NOW.getTime() - weeksAgo * 7 * DAY
  return {
    goal: {
      id: 1, user_id: 1, calorie_target: calorieTarget, protein_target: 160, carb_target: 200, fat_target: 60,
      target_weight: 184, source: 'ai', notes: '', effective_at: new Date(start).toISOString(),
      created_at: new Date(start).toISOString(),
    },
    projections: Array.from({ length: 17 }, (_, w) => ({
      week: w, expected_weight: 200 - w, expected_date: new Date(start + w * 7 * DAY).toISOString(),
    })),
    plan_timeline: [], actual_forecast: [], original_plan: [], journey_start: new Date(start).toISOString(),
  }
}

/** Daily weigh-ins over the last `days`, ending at `endWeight`, moving `perWeek` lb/week down. */
function weights(days: number, endWeight: number, perWeek: number): WeightLog[] {
  return Array.from({ length: days }, (_, i) => ({
    id: i, weight: endWeight + (perWeek / 7) * i, logged_at: new Date(NOW.getTime() - i * DAY).toISOString(),
  }))
}

function food(days: number, calories: number): FoodHistoryPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(NOW.getTime() - i * DAY).toISOString().slice(0, 10), calories, protein: 150, carbs: 200, fat: 60,
  }))
}

describe('expectedAt', () => {
  it('interpolates and clamps', () => {
    const pts = [{ t: 0, w: 200 }, { t: 10, w: 190 }]
    expect(expectedAt(pts, 5)).toBe(195)
    expect(expectedAt(pts, -5)).toBe(200)
    expect(expectedAt(pts, 50)).toBe(190)
  })
})

describe('buildPlanPulse', () => {
  it('is too early in the first two weeks, with a re-check date', () => {
    const p = buildPlanPulse({ now: NOW, plan: plan(1), weightLogs: weights(7, 199, 1), foodHistory: food(7, 2000), adherence: null })
    expect(p.verdict).toBe('too-early')
    expect(p.recheckOn!.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('is on track when pace matches the plan', () => {
    // 6 weeks in → plan expects 194. Trend at 194, losing 1 lb/week.
    const p = buildPlanPulse({ now: NOW, plan: plan(6), weightLogs: weights(21, 194, 1), foodHistory: food(14, 2000), adherence: null })
    expect(p.verdict).toBe('on-track')
    expect(p.expectedNow).toBeCloseTo(194, 0)
    expect(p.recentRate).toBeCloseTo(1, 1)
    expect(p.weekOfPlan).toBe(7)
    expect(p.totalWeeks).toBe(16)
  })

  it('blames logging, not the plan, when behind with thin data', () => {
    const p = buildPlanPulse({ now: NOW, plan: plan(6), weightLogs: weights(21, 197, 0.3), foodHistory: food(6, 2000), adherence: null })
    expect(p.verdict).toBe('fix-logging')
    expect(p.recheckOn).not.toBeNull()
  })

  it('blames calories when behind and eating over target', () => {
    const p = buildPlanPulse({ now: NOW, plan: plan(6), weightLogs: weights(21, 197, 0.3), foodHistory: food(14, 2400), adherence: null })
    expect(p.verdict).toBe('fix-calories')
  })

  it('says adjust the plan only when following it and still behind', () => {
    const p = buildPlanPulse({ now: NOW, plan: plan(6), weightLogs: weights(21, 197, 0.3), foodHistory: food(14, 1980), adherence: null })
    expect(p.verdict).toBe('adjust-plan')
    expect(p.tone).toBe('act')
    expect(p.behindBy).toBeGreaterThan(1)
  })

  it('flags losing much faster than planned', () => {
    const p = buildPlanPulse({ now: NOW, plan: plan(6), weightLogs: weights(21, 190, 2.5), foodHistory: food(14, 1500), adherence: null })
    expect(p.verdict).toBe('ahead-too-fast')
  })

  it('projects a goal date from the recent pace', () => {
    const p = buildPlanPulse({ now: NOW, plan: plan(6), weightLogs: weights(21, 194, 1), foodHistory: food(14, 2000), adherence: null })
    // 10 lb left at 1 lb/week ≈ 10 weeks out.
    const weeks = (p.projectedGoalDate!.getTime() - NOW.getTime()) / (7 * DAY)
    expect(weeks).toBeCloseTo(10, 0)
  })

  it('recognises a reached goal', () => {
    const p = buildPlanPulse({ now: NOW, plan: plan(15), weightLogs: weights(21, 183.5, 1), foodHistory: food(14, 2000), adherence: null })
    expect(p.verdict).toBe('goal-reached')
  })
})
