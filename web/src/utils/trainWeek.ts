/**
 * One week of training, day by day: what was planned, what got done (lifts),
 * and what cardio synced in from the watch. Pure so the hub's week strip and
 * its stats agree, and so it can be tested without a server.
 */
import { format, addDays, startOfWeek } from 'date-fns'
import type { CardioSession, ScheduledDay, Workout } from '../types'

export type DayStatus = 'done' | 'partial' | 'missed' | 'planned' | 'rest' | 'extra'

export interface TrainDay {
  date: string
  label: string        // Mon, Tue…
  isToday: boolean
  isPast: boolean
  planned: { id: number; name: string; done: boolean }[]
  workouts: Workout[]
  cardioMinutes: number
  status: DayStatus
}

export interface TrainWeek {
  days: TrainDay[]
  plannedSessions: number
  doneSessions: number
  liftSessions: number
  cardioMinutes: number
  cardioSessions: number
}

const dayKey = (iso: string) => format(new Date(iso), 'yyyy-MM-dd')

export function buildTrainWeek(
  now: Date,
  schedule: ScheduledDay[],
  workouts: Workout[],
  cardio: CardioSession[],
): TrainWeek {
  const start = startOfWeek(now, { weekStartsOn: 1 })
  const today = format(now, 'yyyy-MM-dd')
  const byDate = new Map(schedule.map(d => [d.date, d]))

  const days: TrainDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i)
    const date = format(d, 'yyyy-MM-dd')
    const planned = (byDate.get(date)?.programs ?? []).map(p => ({
      id: p.program_id, name: p.name, done: !!p.completed_workout_id,
    }))
    const dayWorkouts = workouts.filter(w => dayKey(w.started_at) === date)
    const dayCardio = cardio.filter(c => dayKey(c.started_at) === date)
    const cardioMinutes = Math.round(dayCardio.reduce((s, c) => s + c.duration_seconds, 0) / 60)
    const isPast = date < today
    const doneCount = planned.filter(p => p.done).length
    const trained = dayWorkouts.length > 0 || cardioMinutes > 0

    let status: DayStatus
    if (planned.length === 0) status = trained ? 'extra' : 'rest'
    else if (doneCount === planned.length) status = 'done'
    else if (doneCount > 0 || trained) status = 'partial'
    else status = isPast ? 'missed' : 'planned'

    return {
      date, label: format(d, 'EEE'), isToday: date === today, isPast,
      planned, workouts: dayWorkouts, cardioMinutes, status,
    }
  })

  const weekCardio = cardio.filter(c => {
    const k = dayKey(c.started_at)
    return k >= days[0].date && k <= days[6].date
  })

  return {
    days,
    plannedSessions: days.reduce((s, d) => s + d.planned.length, 0),
    doneSessions: days.reduce((s, d) => s + d.planned.filter(p => p.done).length, 0),
    liftSessions: days.reduce((s, d) => s + d.workouts.length, 0),
    cardioMinutes: days.reduce((s, d) => s + d.cardioMinutes, 0),
    cardioSessions: weekCardio.length,
  }
}

/** The next session to do: today's first pending program, else the next planned day. */
export function nextSession(upcoming: ScheduledDay[], today: string): { date: string; programId: number; name: string } | null {
  for (const d of [...upcoming].sort((a, b) => a.date.localeCompare(b.date))) {
    if (d.date < today) continue
    const p = d.programs.find(x => !x.completed_workout_id)
    if (p) return { date: d.date, programId: p.program_id, name: p.name }
  }
  return null
}
