import { describe, it, expect } from 'vitest'
import { buildTrainWeek, goalProgress, nextSession } from './trainWeek'
import type { CardioSession, ScheduledDay, TrainingTypeDay, Workout } from '../types'

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

const td = (date: string, s = 0, c = 0, m = 0, minutes = 30): TrainingTypeDay => ({
  date,
  strength: { sessions: s, minutes: s ? 60 : 0 },
  cardio: { sessions: c, minutes: c ? minutes : 0 },
  mobility: { sessions: m, minutes: m ? 10 : 0 },
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
    // The server's per-type rollup; a day outside the week is ignored.
    [td('2026-11-09', 1), td('2026-11-12', 0, 1), td('2026-11-01', 0, 1, 0, 99)],
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

describe('buildTrainWeek — training types', () => {
  const w = buildTrainWeek(NOW, [day('2026-11-09', [prog(1, 'Push', 77)])], [], [], [
    td('2026-11-09', 1, 0, 1),     // lift + stretch
    td('2026-11-10', 0, 0, 1),     // stretch only, nothing planned
    td('2026-11-11', 0, 2, 0, 45), // two walks
  ])

  it('keeps a stretch-only day a rest day, but records the stretch', () => {
    expect(w.days[1].status).toBe('rest')
    expect(w.days[1].kinds.mobility.sessions).toBe(1)
  })

  it('counts days and minutes per type', () => {
    expect(w.byKind.strength).toEqual({ days: 1, minutes: 60, sessions: 1 })
    expect(w.byKind.mobility).toEqual({ days: 2, minutes: 20, sessions: 2 })
    expect(w.byKind.cardio).toEqual({ days: 1, minutes: 45, sessions: 2 })
    expect(w.liftSessions).toBe(1)
  })
})

describe('goalProgress', () => {
  const byKind = {
    strength: { days: 3, minutes: 180, sessions: 3 },
    cardio: { days: 4, minutes: 95, sessions: 5 },
    mobility: { days: 6, minutes: 30, sessions: 6 },
  }
  const [s, c, m] = goalProgress(byKind, [
    { kind: 'strength', days_per_week: 3, minutes_per_week: 0 },
    { kind: 'cardio', days_per_week: 3, minutes_per_week: 150 },
    { kind: 'mobility', days_per_week: 0, minutes_per_week: 0 },
  ])

  it('is met on the days axis alone', () => {
    expect(s.met).toBe(true)
    expect(s.label).toBe('3/3 days')
  })

  it('uses the weaker axis when both are set', () => {
    expect(c.met).toBe(false)
    expect(c.ratio).toBeCloseTo(95 / 150)
    expect(c.label).toBe('4/3 days · 95/150 min')
  })

  it('treats a goal with no target as not set rather than met', () => {
    expect(m.met).toBe(false)
    expect(m.label).toBe('No goal set')
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
