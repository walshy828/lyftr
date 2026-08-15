import { describe, it, expect } from 'vitest'
import {
  calcVolume, weekRange, weeklyTraining, daysSinceLastWorkout, untrainedFocusRegions,
  weeklyNutrition, delta, olsTrend, weightSeries, goalDirection, goalProgress, buildInsights,
  elapsedDays, firstDaysOf,
  workoutMinutesByCategory, activityMix, weeklyCardio,
  type InsightSignals, type WeeklyNutrition,
} from './dashboardMetrics'
import type { Workout, FoodHistoryPoint, WeightLog, WorkoutExercise, CardioSession } from '../types'

// Wednesday, 2026-07-15 12:00 local — mid-week reference.
const NOW = new Date(2026, 6, 15, 12, 0, 0)

function workout(dateIso: string, muscle: string, sets: number, reps = 5, weight = 100): Workout {
  return {
    id: Math.random(), name: 'W', duration: 3600, started_at: dateIso, created_at: dateIso,
    exercises: [{
      exercise_id: 1, exercise: { id: 1, name: 'x', muscle_group: muscle, secondary_muscles: [], category: 'strength', equipment: '', description: '' },
      sets: Array.from({ length: sets }, (_, i) => ({ set_number: i + 1, reps, weight })),
    }],
  }
}

describe('calcVolume', () => {
  it('sums reps × weight across sets', () => {
    expect(calcVolume(workout('2026-07-15T12:00:00', 'chest', 3, 5, 100))).toBe(1500)
  })
  it('handles missing exercises/sets', () => {
    expect(calcVolume({ exercises: [] })).toBe(0)
  })
})

describe('weekRange / weeklyTraining', () => {
  it('week is Monday..Sunday around the reference', () => {
    const r = weekRange(NOW)
    // 2026-07-15 is a Wednesday → week starts Mon 2026-07-13
    expect(r.start.getDay()).toBe(1) // Monday
    expect(r.end.getDay()).toBe(0)   // Sunday
    expect(r.start.getDate()).toBe(13)
  })

  it('counts only this-week sessions and sums their volume', () => {
    const ws = [
      workout('2026-07-14T09:00:00', 'chest', 3),   // this week
      workout('2026-07-15T09:00:00', 'legs', 2),    // this week
      workout('2026-07-06T09:00:00', 'back', 4),    // last week — excluded
    ]
    const { sessions, volume } = weeklyTraining(ws, weekRange(NOW))
    expect(sessions).toBe(2)
    expect(volume).toBe(calcVolume(ws[0]) + calcVolume(ws[1]))
  })

  it('prior week window excludes this week', () => {
    const ws = [workout('2026-07-06T09:00:00', 'back', 4), workout('2026-07-14T09:00:00', 'chest', 3)]
    expect(weeklyTraining(ws, weekRange(NOW, 1)).sessions).toBe(1)
  })
})

function cardioSession(startedAtIso: string, durationSeconds = 1800): CardioSession {
  return {
    id: Math.random(), external_id: `ext-${Math.random()}`, activity_type: 'running',
    started_at: startedAtIso, ended_at: startedAtIso, duration_seconds: durationSeconds,
    distance_meters: 0, avg_heart_rate: 0, calories: 0, source: 'health_connect',
  }
}

describe('weeklyCardio', () => {
  it('counts only this-week sessions and sums their duration', () => {
    const sessions = [
      cardioSession('2026-07-14T09:00:00', 1800), // this week
      cardioSession('2026-07-15T09:00:00', 900),  // this week
      cardioSession('2026-07-06T09:00:00', 3600), // last week — excluded
    ]
    const { sessions: count, duration } = weeklyCardio(sessions, weekRange(NOW))
    expect(count).toBe(2)
    expect(duration).toBe(2700)
  })

  it('returns zeros for an empty list', () => {
    expect(weeklyCardio([], weekRange(NOW))).toEqual({ sessions: 0, duration: 0 })
  })

  it('prior week window excludes this week', () => {
    const sessions = [cardioSession('2026-07-06T09:00:00'), cardioSession('2026-07-14T09:00:00')]
    expect(weeklyCardio(sessions, weekRange(NOW, 1)).sessions).toBe(1)
  })
})

describe('daysSinceLastWorkout', () => {
  it('null with no workouts', () => {
    expect(daysSinceLastWorkout([], NOW)).toBeNull()
  })
  it('counts whole days since the most recent', () => {
    expect(daysSinceLastWorkout([workout('2026-07-13T12:00:00', 'chest', 1)], NOW)).toBe(2)
  })
})

describe('untrainedFocusRegions', () => {
  it('flags regions not trained in the window', () => {
    const ws = [workout('2026-07-14T09:00:00', 'chest', 3)] // Upper only
    const gaps = untrainedFocusRegions(ws, NOW, 14)
    expect(gaps).toContain('Lower')
    expect(gaps).toContain('Core')
    expect(gaps).not.toContain('Upper')
  })
  it('ignores workouts older than the window', () => {
    const ws = [workout('2026-06-01T09:00:00', 'legs', 3)]
    expect(untrainedFocusRegions(ws, NOW, 14)).toContain('Lower')
  })
})

describe('workoutMinutesByCategory / activityMix', () => {
  const ex = (muscle: string, category: string, sets: number): WorkoutExercise => ({
    exercise_id: 1,
    exercise: { id: 1, name: 'x', muscle_group: muscle, secondary_muscles: [], category, equipment: '', description: '' },
    sets: Array.from({ length: sets }, (_, i) => ({ set_number: i + 1, reps: 5, weight: 100 })),
  })
  const wk = (durationSec: number, exercises: WorkoutExercise[]): Workout => ({
    id: Math.random(), name: 'W', duration: durationSec, started_at: '2026-07-15T09:00:00', created_at: '2026-07-15T09:00:00', exercises,
  })

  it('splits duration across categories proportional to set count', () => {
    // 60 min, 3 upper sets + 1 lower set → 45m Upper, 15m Lower
    const m = workoutMinutesByCategory(wk(3600, [ex('chest', 'strength', 3), ex('legs', 'strength', 1)]))
    expect(m.get('Upper')).toBe(45)
    expect(m.get('Lower')).toBe(15)
  })

  it('maps cardio exercises to the Cardio category', () => {
    const m = workoutMinutesByCategory(wk(1800, [ex('cardio', 'cardio', 1)]))
    expect(m.get('Cardio')).toBe(30)
    expect(m.has('Upper')).toBe(false)
  })

  it('ignores exercises with no sets and no focus mapping', () => {
    const m = workoutMinutesByCategory(wk(3600, [ex('chest', 'strength', 2), ex('mystery', 'strength', 2)]))
    // unmapped muscle contributes no category, so all 60m lands on Upper
    expect(m.get('Upper')).toBe(60)
    expect(m.size).toBe(1)
  })

  it('returns an empty map when nothing is trackable', () => {
    expect(workoutMinutesByCategory(wk(3600, [])).size).toBe(0)
  })

  it('activityMix sums per-category minutes across workouts', () => {
    const mix = activityMix([
      wk(3600, [ex('chest', 'strength', 1)]),   // 60m Upper
      wk(1800, [ex('cardio', 'cardio', 1)]),    // 30m Cardio
      wk(3600, [ex('back', 'strength', 1)]),    // 60m Upper
    ])
    expect(mix.get('Upper')).toBe(120)
    expect(mix.get('Cardio')).toBe(30)
  })
})

describe('weeklyNutrition', () => {
  const hist: FoodHistoryPoint[] = [
    { date: '2026-07-13', calories: 2000, protein: 160, carbs: 200, fat: 60 },
    { date: '2026-07-14', calories: 1800, protein: 140, carbs: 180, fat: 55 },
    { date: '2026-07-15', calories: 0, protein: 0, carbs: 0, fat: 0 }, // not logged
    { date: '2026-07-06', calories: 2200, protein: 170, carbs: 210, fat: 70 }, // last week
  ]
  it('averages over logged days only and counts protein hits', () => {
    const n = weeklyNutrition(hist, 150, weekRange(NOW), NOW)
    expect(n.daysLogged).toBe(2)
    expect(n.avgCalories).toBe(1900)
    expect(n.proteinHitDays).toBe(1) // only 160 >= 150
  })
  it('zero when nothing logged in-window', () => {
    const n = weeklyNutrition([], 150, weekRange(NOW), NOW)
    expect(n.daysLogged).toBe(0)
    expect(n.avgCalories).toBe(0)
  })
  it('denominator is the days elapsed, and never smaller than days logged', () => {
    // Wednesday: Mon/Tue/Wed exist, so the window is 3 — never 7.
    const n = weeklyNutrition(hist, 150, weekRange(NOW), NOW)
    expect(n.daysInWindow).toBe(3)
    expect(n.daysLogged).toBeLessThanOrEqual(n.daysInWindow)
  })
  it('a completed week is scored over its full 7 days', () => {
    expect(weeklyNutrition(hist, 150, weekRange(NOW, 1), NOW).daysInWindow).toBe(7)
  })
})

describe('elapsedDays / firstDaysOf', () => {
  it('counts days elapsed in the in-progress week', () => {
    expect(elapsedDays(weekRange(NOW), NOW)).toBe(3) // Mon, Tue, Wed
  })
  it('a past week is fully elapsed', () => {
    expect(elapsedDays(weekRange(NOW, 1), NOW)).toBe(7)
  })
  it('truncates a week to its first n days for like-for-like comparison', () => {
    const prev = firstDaysOf(weekRange(NOW, 1), 3)
    expect(elapsedDays(prev, NOW)).toBe(3)
    // Mon 2026-07-06 .. end of Wed 2026-07-08
    expect(prev.end.getDate()).toBe(8)
  })
})

describe('delta', () => {
  it('computes abs and pct', () => {
    expect(delta(120, 100)).toEqual({ abs: 20, pct: 20 })
  })
  it('pct null when prior is zero', () => {
    expect(delta(120, 0)).toEqual({ abs: 120, pct: null })
  })
})

describe('olsTrend / weightSeries', () => {
  it('null under two points', () => {
    expect(olsTrend([{ ts: 1, weight: 200 }])).toBeNull()
  })
  it('recovers a downward slope', () => {
    const logs: WeightLog[] = [
      { id: 1, weight: 200, logged_at: '2026-07-01T12:00:00' },
      { id: 2, weight: 198, logged_at: '2026-07-08T12:00:00' },
      { id: 3, weight: 196, logged_at: '2026-07-15T12:00:00' },
    ]
    const t = olsTrend(weightSeries(logs))!
    expect(t.slopePerDay).toBeLessThan(0)
    expect(t.firstVal).toBeCloseTo(200, 0)
    expect(t.lastVal).toBeCloseTo(196, 0)
  })
})

describe('goalDirection / goalProgress', () => {
  it('classifies loss/gain/maintain', () => {
    expect(goalDirection(175, 200)).toBe('loss')
    expect(goalDirection(200, 175)).toBe('gain')
    expect(goalDirection(180, 180)).toBe('maintain')
  })
  it('progress is fraction of the way to target, clamped', () => {
    expect(goalProgress(200, 190, 175)).toBeCloseTo(0.4, 5) // lost 10 of 25
    expect(goalProgress(200, 210, 175)).toBe(0) // moved wrong way
    expect(goalProgress(200, 170, 175)).toBe(1) // overshot
  })
})

describe('buildInsights', () => {
  const baseNut: WeeklyNutrition = { avgCalories: 2000, avgProtein: 100, avgCarbs: 200, avgFat: 60, daysLogged: 3, daysInWindow: 7, proteinHitDays: 2 }
  const base: InsightSignals = {
    nutrition: baseNut, calorieTarget: 2000, sessionsThisWeek: 1, daysSinceWorkout: 2,
    untrainedRegions: [], weightChange7d: 0, weightUnit: 'lb', goal: null,
  }

  it('celebrates protein consistency and logging', () => {
    const out = buildInsights({ ...base, nutrition: { ...baseNut, proteinHitDays: 6, daysLogged: 7 } })
    expect(out.some(i => i.tone === 'good' && /Protein/.test(i.text))).toBe(true)
    expect(out.some(i => i.tone === 'good' && /Consistent logging/.test(i.text))).toBe(true)
  })

  it('flags sparse logging and inactivity', () => {
    const out = buildInsights({ ...base, nutrition: { ...baseNut, daysLogged: 2 }, daysSinceWorkout: 9 })
    expect(out.some(i => i.tone === 'focus' && /Logging slipped/.test(i.text))).toBe(true)
    expect(out.some(i => i.tone === 'focus' && /No workouts/.test(i.text))).toBe(true)
  })

  // The partial-week regression: mid-week, a perfectly-logged 3 days must read
  // as consistency out of 3 — not as "3 of 7" sparse logging.
  it('scores a partial week against the days elapsed, not a flat 7', () => {
    const out = buildInsights({
      ...base, nutrition: { ...baseNut, daysLogged: 3, daysInWindow: 3, proteinHitDays: 3 },
    })
    expect(out.some(i => i.tone === 'good' && /tracked food 3 of 3 days/.test(i.text))).toBe(true)
    expect(out.some(i => /Logging slipped/.test(i.text))).toBe(false)
  })

  it('makes no consistency claim in the first days of a week', () => {
    const out = buildInsights({
      ...base, nutrition: { ...baseNut, daysLogged: 1, daysInWindow: 1, proteinHitDays: 1 },
    })
    expect(out.some(i => /Consistent logging|Protein on point/.test(i.text))).toBe(false)
  })

  it('weight direction insights require an active goal', () => {
    const noGoal = buildInsights({ ...base, weightChange7d: -1.2 })
    expect(noGoal.some(i => /toward goal/.test(i.text))).toBe(false)
    const withGoal = buildInsights({ ...base, weightChange7d: -1.2, goal: 'loss' })
    expect(withGoal.some(i => i.tone === 'good' && /toward goal/.test(i.text))).toBe(true)
  })

  it('caps at two good and two focus', () => {
    const out = buildInsights({
      ...base, goal: 'loss', weightChange7d: -1,
      nutrition: { ...baseNut, proteinHitDays: 7, daysLogged: 7, avgCalories: 2000 },
      sessionsThisWeek: 5, daysSinceWorkout: 9, untrainedRegions: ['Lower'],
    })
    expect(out.filter(i => i.tone === 'good').length).toBeLessThanOrEqual(2)
    expect(out.filter(i => i.tone === 'focus').length).toBeLessThanOrEqual(2)
  })
})
