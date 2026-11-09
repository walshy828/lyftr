import { describe, it, expect } from 'vitest'
import { buildTodayFocus, dayProgress } from './todayFocus'
import type { DailyStats } from '../types'

const food = (kcal: number, protein: number): DailyStats => ({
  date: '2026-11-09', total_calories: kcal, total_protein: protein, total_carbs: 0, total_fat: 0,
  total_fiber: 0, total_sodium: 0, total_cholesterol: 0, workout_count: 0,
})
const settings = { calorie_target: 2000, protein_target: 160 }
const at = (h: number) => new Date(2026, 10, 9, h)

describe('dayProgress', () => {
  it('clamps to the 7am–9pm eating window', () => {
    expect(dayProgress(at(5))).toBe(0)
    expect(dayProgress(at(14))).toBeCloseTo(0.5)
    expect(dayProgress(at(23))).toBe(1)
  })
})

describe('buildTodayFocus', () => {
  it('asks for a weigh-in when the last one is not today', () => {
    const items = buildTodayFocus({
      now: at(8), food: food(0, 0), settings, todaysPlan: null,
      lastWeight: { id: 1, weight: 170, logged_at: new Date(2026, 10, 6, 7).toISOString() },
    })
    expect(items[0]).toMatchObject({ id: 'weigh', tone: 'todo', action: 'weigh' })
    expect(items[0].detail).toContain('3 days')
  })

  it('marks the weigh-in done when logged today', () => {
    const items = buildTodayFocus({
      now: at(8), food: food(0, 0), settings, todaysPlan: null,
      lastWeight: { id: 1, weight: 170, logged_at: new Date(2026, 10, 9, 7).toISOString() },
    })
    expect(items.find(i => i.id === 'weigh')?.tone).toBe('good')
  })

  it('does not nag about protein early in the day', () => {
    const items = buildTodayFocus({ now: at(9), food: food(400, 30), settings, todaysPlan: null, lastWeight: null })
    expect(items.find(i => i.id === 'protein')).toBeUndefined()
  })

  it('flags a protein gap in the evening', () => {
    const items = buildTodayFocus({ now: at(19), food: food(1500, 80), settings, todaysPlan: null, lastWeight: null })
    expect(items.find(i => i.id === 'protein')).toMatchObject({ tone: 'focus', title: '80 g protein to go' })
  })

  it('surfaces the pending planned session with a start action', () => {
    const items = buildTodayFocus({
      now: at(12), food: food(800, 60), settings, lastWeight: null,
      todaysPlan: { date: '2026-11-09', weekday: 1, source: 'recurring', programs: [
        { program_id: 1, name: 'Push Day', exercise_count: 5, order_index: 0 },
      ] },
    })
    expect(items.find(i => i.id === 'train')).toMatchObject({ tone: 'todo', action: 'start-workout', title: 'Push Day' })
  })

  it('orders todo before focus before good', () => {
    const items = buildTodayFocus({ now: at(20), food: food(2300, 170), settings, todaysPlan: null, lastWeight: null })
    expect(items.map(i => i.tone)).toEqual(['todo', 'focus', 'good'])
  })
})
