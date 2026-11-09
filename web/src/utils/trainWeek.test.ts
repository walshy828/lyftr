import { describe, it, expect } from 'vitest'
import { buildTrainWeek, nextSession } from './trainWeek'
import type { CardioSession, ScheduledDay, Workout } from '../types'

// Wednesday 2026-11-11
const NOW = new Date(2026, 10, 11, 10)

const day = (date: string, programs: ScheduledDay['programs']): ScheduledDay =>
  ({ date, weekday: 0, source: 'recurring', programs })
const prog = (id: number, name: string, done?: number) =>
  ({ program_id: id, name, exercise_count: 5, order_index: 0, completed_workout_id: done })
const workout = (iso: string): Workout =>
  ({ id: 1, name: 'W', duration: 3600, started_at: iso, created_at: iso, exercises: [] })
const cardio = (iso: string, min: number): CardioSession => ({
  id: 1, external_id: 'x', activity_type: 'running', started_at: iso, ended_at: iso,
  duration_seconds: min * 60, distance_meters: 0, avg_heart_rate: 0, calories: 0, source: 'hc',
})

describe('buildTrainWeek', () => {
  const schedule = [
    day('2026-11-09', [prog(1, 'Push', 77)]),   // Mon done
    day('2026-11-10', [prog(2, 'Pull')]),       // Tue missed
    day('2026-11-11', [prog(3, 'Legs')]),       // Wed today, pending
    day('2026-11-13', [prog(1, 'Push')]),       // Fri upcoming
  ]
  const w = buildTrainWeek(
    NOW, schedule,
    [workout(new Date(2026, 10, 9, 18).toISOString())],
    [cardio(new Date(2026, 10, 12, 7).toISOString(), 30), cardio(new Date(2026, 10, 1, 7).toISOString(), 99)],
  )

  it('labels each day by what happened vs the plan', () => {
    expect(w.days.map(d => d.status)).toEqual(['done', 'missed', 'planned', 'extra', 'planned', 'rest', 'rest'])
    expect(w.days[2].isToday).toBe(true)
  })

  it('counts synced cardio as training on an unplanned day, only within the week', () => {
    expect(w.days[3].cardioMinutes).toBe(30)
    expect(w.cardioMinutes).toBe(30)
    expect(w.cardioSessions).toBe(1)
  })

  it('totals planned vs done', () => {
    expect(w.plannedSessions).toBe(4)
    expect(w.doneSessions).toBe(1)
    expect(w.liftSessions).toBe(1)
  })
})

describe('nextSession', () => {
  it('skips past days and done programs', () => {
    const n = nextSession([
      day('2026-11-10', [prog(2, 'Pull')]),
      day('2026-11-11', [prog(3, 'Legs', 9)]),
      day('2026-11-13', [prog(1, 'Push')]),
    ], '2026-11-11')
    expect(n).toEqual({ date: '2026-11-13', programId: 1, name: 'Push' })
  })
  it('is null with nothing planned', () => {
    expect(nextSession([], '2026-11-11')).toBeNull()
  })
})
