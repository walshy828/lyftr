/**
 * One week of training, day by day: what was planned, and what got done
 * split by training type — strength, cardio (logged or synced from the
 * watch) and mobility. Pure so the hub's week strip, its goal bars and its
 * stats agree, and so it can be tested without a server.
 *
 * The per-type numbers come from GET /training/days (server-side, so a mixed
 * session's minutes are split the same way everywhere); workouts and cardio
 * lists are only used for names and the activity feed.
 */
import { format, addDays, startOfWeek } from 'date-fns'
import type {
  CardioSession, KindTotals, Modality, ScheduledDay, TrainingGoal, TrainingKind, TrainingTypeDay, Workout,
} from '../types'
import { MODALITIES } from './trainingKinds'

export type DayStatus = 'done' | 'partial' | 'missed' | 'planned' | 'rest' | 'extra'

export type KindSplit = Record<Modality, KindTotals>

export interface TrainDay {
  date: string
  label: string        // Mon, Tue…
  isToday: boolean
  isPast: boolean
  planned: { id: number; name: string; kind?: TrainingKind; done: boolean }[]
  workouts: Workout[]
  kinds: KindSplit
  cardioMinutes: number
  status: DayStatus
}

export interface KindWeek {
  /** Days this week with at least one session of this type. */
  days: number
  minutes: number
  sessions: number
}

export interface TrainWeek {
  days: TrainDay[]
  plannedSessions: number
  doneSessions: number
  liftSessions: number
  cardioMinutes: number
  cardioSessions: number
  byKind: Record<Modality, KindWeek>
}

const dayKey = (iso: string) => format(new Date(iso), 'yyyy-MM-dd')
const zero = (): KindSplit => ({
  strength: { sessions: 0, minutes: 0 },
  cardio: { sessions: 0, minutes: 0 },
  mobility: { sessions: 0, minutes: 0 },
})

export function buildTrainWeek(
  now: Date,
  schedule: ScheduledDay[],
  workouts: Workout[],
  _cardio: CardioSession[],
  typeDays: TrainingTypeDay[] = [],
): TrainWeek {
  const start = startOfWeek(now, { weekStartsOn: 1 })
  const today = format(now, 'yyyy-MM-dd')
  const byDate = new Map(schedule.map(d => [d.date, d]))
  const typeByDate = new Map(typeDays.map(d => [d.date, d]))

  const days: TrainDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i)
    const date = format(d, 'yyyy-MM-dd')
    const planned = (byDate.get(date)?.programs ?? []).map(p => ({
      id: p.program_id, name: p.name, kind: p.kind, done: !!p.completed_workout_id,
    }))
    const dayWorkouts = workouts.filter(w => dayKey(w.started_at) === date)
    const t = typeByDate.get(date)
    const kinds: KindSplit = t ? { strength: t.strength, cardio: t.cardio, mobility: t.mobility } : zero()
    const isPast = date < today
    const doneCount = planned.filter(p => p.done).length
    const trained = MODALITIES.some(m => kinds[m].sessions > 0)
    // A stretch alone doesn't turn a rest day into a training day: rest means
    // no lifting and no cardio, and mobility is welcome on it.
    const trainedHard = kinds.strength.sessions > 0 || kinds.cardio.sessions > 0

    let status: DayStatus
    if (planned.length === 0) status = trainedHard ? 'extra' : 'rest'
    else if (doneCount === planned.length) status = 'done'
    else if (doneCount > 0 || trained) status = 'partial'
    else status = isPast ? 'missed' : 'planned'

    return {
      date, label: format(d, 'EEE'), isToday: date === today, isPast,
      planned, workouts: dayWorkouts, kinds, cardioMinutes: kinds.cardio.minutes, status,
    }
  })

  const byKind = Object.fromEntries(MODALITIES.map(m => [m, {
    days: days.filter(d => d.kinds[m].sessions > 0).length,
    minutes: days.reduce((s, d) => s + d.kinds[m].minutes, 0),
    sessions: days.reduce((s, d) => s + d.kinds[m].sessions, 0),
  }])) as Record<Modality, KindWeek>

  return {
    days,
    plannedSessions: days.reduce((s, d) => s + d.planned.length, 0),
    doneSessions: days.reduce((s, d) => s + d.planned.filter(p => p.done).length, 0),
    liftSessions: byKind.strength.sessions,
    cardioMinutes: byKind.cardio.minutes,
    cardioSessions: byKind.cardio.sessions,
    byKind,
  }
}

export interface GoalProgress {
  kind: Modality
  goal: TrainingGoal
  done: KindWeek
  /** 0..1 on the axis the goal is measured on (the further-behind one when both are set). */
  ratio: number
  met: boolean
  /** "2/3 days", "95/150 min", or both. */
  label: string
}

/**
 * How each type is tracking against its weekly goal. With both a days and a
 * minutes target, progress is the weaker of the two — 7 five-minute stretches
 * shouldn't read as a met 70-minute goal.
 */
export function goalProgress(byKind: Record<Modality, KindWeek>, goals: TrainingGoal[]): GoalProgress[] {
  return goals.map(goal => {
    const done = byKind[goal.kind]
    const parts: string[] = []
    const ratios: number[] = []
    if (goal.days_per_week > 0) {
      ratios.push(done.days / goal.days_per_week)
      parts.push(`${done.days}/${goal.days_per_week} days`)
    }
    if (goal.minutes_per_week > 0) {
      ratios.push(done.minutes / goal.minutes_per_week)
      parts.push(`${done.minutes}/${goal.minutes_per_week} min`)
    }
    const ratio = ratios.length ? Math.min(...ratios) : 0
    return {
      kind: goal.kind, goal, done, ratio: Math.min(ratio, 1), met: ratios.length > 0 && ratio >= 1,
      label: parts.length ? parts.join(' · ') : 'No goal set',
    }
  })
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
