import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { format, startOfWeek, addDays, parseISO } from 'date-fns'
import {
  Play, Plus, Check, X, Circle, CalendarRange, Library, Timer, BarChart3, History, Target,
} from 'lucide-react'
import { scheduleAPI, workoutAPI, cardioAPI, programAPI, trainingAPI } from '../services/api'
import { useWorkoutSession } from '../stores/workoutSession'
import { buildTrainWeek, goalProgress, nextSession, type TrainDay } from '../utils/trainWeek'
import { KIND_META, MODALITIES, kindsOf } from '../utils/trainingKinds'
import { GoalBars, GoalsSheet } from '../components/training/TrainingGoals'
import TrainSheet from '../components/training/TrainSheet'
import RoutineList from '../components/training/RoutineList'
import QuickCardioModal from '../components/QuickCardioModal'
import Loading from '../components/Loading'
import * as types from '../types'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/**
 * Train — everything about training in one place, top to bottom in the order
 * it's needed: one button to start or log anything, how this week stands
 * against the goals, what's on today, the routines themselves, and recent
 * history with the way into Trends. Editing the weekly pattern lives one level
 * down on /train/schedule.
 */
export default function Train() {
  const navigate = useNavigate()
  const { hash } = useLocation()
  const [params, setParams] = useSearchParams()
  const { session } = useWorkoutSession()
  const [now, setNow] = useState(() => new Date())
  const [schedule, setSchedule] = useState<types.ScheduleResponse | null>(null)
  const [workouts, setWorkouts] = useState<types.Workout[]>([])
  const [cardio, setCardio] = useState<types.CardioSession[]>([])
  const [routines, setRoutines] = useState<types.Program[]>([])
  const [next, setNext] = useState<types.Program | null>(null)
  const [typeDays, setTypeDays] = useState<types.TrainingTypeDay[]>([])
  const [goals, setGoals] = useState<types.TrainingGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [showCardio, setShowCardio] = useState(false)
  const [showGoals, setShowGoals] = useState(false)
  const showSheet = params.get('start') === '1'
  const setShowSheet = (open: boolean) => setParams(prev => {
    const p = new URLSearchParams(prev)
    if (open) p.set('start', '1'); else p.delete('start')
    return p
  }, { replace: true })

  useEffect(() => {
    const start = startOfWeek(now, { weekStartsOn: 1 })
    Promise.all([
      // Two weeks, so "next session" can roll into next week on a Sunday.
      scheduleAPI.range(iso(start), iso(addDays(start, 13))).catch(() => null),
      workoutAPI.list({ limit: 30 }).catch(() => []),
      cardioAPI.list({ limit: 30 }).catch(() => []),
      programAPI.list({ sort: 'smart', limit: 100 }).catch(() => []),
      trainingAPI.days(iso(start), iso(addDays(start, 6))).catch(() => []),
      trainingAPI.goals().catch(() => []),
    ]).then(([s, w, c, progs, td, g]) => {
      setSchedule(s); setWorkouts(w); setCardio(c); setRoutines(progs ?? [])
      setTypeDays(td); setGoals(g)
    }).finally(() => setLoading(false))
  }, [now])

  // Landing on /train#routines (old /programs links) scrolls to the list.
  useEffect(() => {
    if (!loading && hash === '#routines') document.getElementById('routines')?.scrollIntoView()
  }, [loading, hash])

  const days = useMemo(() => schedule?.days ?? [], [schedule])
  const week = useMemo(() => buildTrainWeek(now, days, workouts, cardio, typeDays), [now, days, workouts, cardio, typeDays])
  const progress = useMemo(() => goalProgress(week.byKind, goals), [week, goals])
  const todayPlan = useMemo(() => days.find(d => d.date === iso(now))?.programs ?? [], [days, now])
  const todayPending = todayPlan.filter(p => !p.completed_workout_id)
  const upNext = useMemo(() => nextSession(days, iso(now)), [days, now])

  useEffect(() => {
    if (!upNext) { setNext(null); return }
    const local = routines.find(r => r.id === upNext.programId)
    if (local) { setNext(local); return }
    programAPI.get(upNext.programId).then(setNext).catch(() => setNext(null))
  }, [upNext, routines])

  const activity = useMemo(() => {
    const rows = [
      ...workouts.map(w => ({ source: 'workout' as const, kind: w.kind ?? kindsOf(w.kind, w.exercises?.map(e => e.exercise))[0], id: w.id, at: w.started_at, title: w.name, sub: `${w.exercises?.length ?? 0} exercises · ${Math.round(w.duration / 60)} min` })),
      ...cardio.map(c => ({ source: 'synced' as const, kind: 'cardio' as const, id: c.id, at: c.started_at, title: c.title || cardioLabel(c.activity_type), sub: `${Math.round(c.duration_seconds / 60)} min${c.distance_meters ? ` · ${(c.distance_meters / 1609.34).toFixed(1)} mi` : ''} · synced` })),
    ]
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  }, [workouts, cardio])

  if (loading) return <Loading />

  const upNextLabel = upNext && upNext.date !== iso(now) ? format(parseISO(upNext.date), 'EEEE') : null

  return (
    <div className="space-y-4 animate-slide-up">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Week of {format(startOfWeek(now, { weekStartsOn: 1 }), 'MMM d')}</p>
          <h1 className="font-display font-bold text-[26px] leading-tight text-tx-primary mt-0.5">Train</h1>
        </div>
        <Link to="/train/schedule" className="btn-secondary btn-sm"><CalendarRange className="w-3.5 h-3.5" /> Schedule</Link>
      </header>

      {session ? (
        <button onClick={() => navigate('/workout/active')} className="btn-primary btn-lg w-full">
          <Timer className="w-4 h-4" /> Resume {session.name}
        </button>
      ) : (
        <button onClick={() => setShowSheet(true)} className="btn-primary btn-lg w-full">
          <Plus className="w-4 h-4" /> Start or log training
        </button>
      )}

      {/* Today — what's scheduled, or what's next if today is clear */}
      <div className="card overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <p className="eyebrow">Today · {format(now, 'EEEE')}</p>
          {todayPlan.length > 0 && todayPending.length === 0 && <span className="text-xs text-train flex items-center gap-1"><Check className="w-3.5 h-3.5" /> All done</span>}
        </div>
        {todayPlan.length > 0 ? (
          <ul className="divide-y divide-surface-border border-t border-surface-border">
            {todayPlan.map(p => {
              const m = KIND_META[p.kind ?? 'strength']
              return (
                <li key={p.program_id} className="px-4 py-3 flex items-center gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.tint}`}><m.icon className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-tx-primary truncate">{p.name}</span>
                    <span className="block text-[11px] text-tx-muted">{p.exercise_count} exercises · {m.label}</span>
                  </span>
                  {p.completed_workout_id ? (
                    <Link to={`/workouts/${p.completed_workout_id}`} className="text-xs text-train flex items-center gap-1 flex-shrink-0"><Check className="w-3.5 h-3.5" /> Done</Link>
                  ) : (
                    <button disabled={!!session} onClick={() => navigate(`/workout/start?program=${p.program_id}`)} className="btn-primary btn-sm flex-shrink-0">
                      <Play className="w-3.5 h-3.5" /> Start
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-4 pb-3 text-sm text-tx-muted">Rest day — nothing scheduled. Start or log anything above.</p>
        )}
        {upNextLabel && todayPending.length === 0 && (
          <div className="px-4 py-3 border-t border-surface-border flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[11px] text-tx-muted">Up next · {upNextLabel}</span>
              <span className="block text-sm font-medium text-tx-primary truncate">{upNext!.name}</span>
              {next && <span className="block text-[11px] text-tx-muted">{next.exercises.length} exercises · {next.exercises.reduce((s, e) => s + e.sets.length, 0)} sets</span>}
            </span>
            <button disabled={!!session} onClick={() => navigate(`/workout/start?program=${upNext!.programId}`)} className="btn-secondary btn-sm flex-shrink-0">
              <Play className="w-3.5 h-3.5" /> Start early
            </button>
          </div>
        )}
        {!upNext && todayPlan.length === 0 && (
          <Link to="/train/schedule" className="px-4 py-3 border-t border-surface-border flex items-center gap-2 text-xs text-brand-400">
            <CalendarRange className="w-3.5 h-3.5" /> Put routines on days of the week to plan ahead
          </Link>
        )}
      </div>

      {/* This week vs goals */}
      <div className="card p-4">
        <div className="grid grid-cols-7 gap-1">
          {week.days.map(d => <DayCell key={d.date} day={d} />)}
        </div>
        <KindLegend />
        <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-surface-border text-center">
          <WeekStat value={week.plannedSessions ? `${week.doneSessions}/${week.plannedSessions}` : '—'} label="planned done" />
          <WeekStat value={String(week.byKind.strength.days)} label={week.byKind.strength.days === 1 ? 'lift day' : 'lift days'} />
          <WeekStat value={`${week.byKind.cardio.minutes}`} label="cardio min" />
          <WeekStat value={String(week.byKind.mobility.days)} label={week.byKind.mobility.days === 1 ? 'stretch day' : 'stretch days'} />
        </div>
        <div className="mt-3 pt-3 border-t border-surface-border">
          {goals.length > 0 ? (
            <GoalBars progress={progress} onEdit={() => setShowGoals(true)} />
          ) : (
            <button onClick={() => setShowGoals(true)} className="w-full flex items-center gap-2 text-left text-xs text-brand-400">
              <Target className="w-3.5 h-3.5" /> Set weekly goals for strength, cardio and mobility
            </button>
          )}
        </div>
      </div>

      <RoutineList routines={routines} recurring={schedule?.recurring ?? {}} />

      {/* Recent — lifts, logged cardio and synced cardio together */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="eyebrow">Recent</p>
          <Link to="/train/history" className="text-xs text-brand-400">Full history</Link>
        </div>
        {activity.length === 0 ? (
          <p className="text-sm text-tx-muted py-2">Nothing logged yet.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {activity.map(a => (
              <li key={`${a.source}-${a.id}`}>
                <Link to={a.source === 'workout' ? `/workouts/${a.id}` : '/stats?tab=cardio'} className="flex items-center gap-3 py-2.5">
                  <ActivityIcon kind={a.kind} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-tx-primary truncate">{a.title}</span>
                    <span className="block text-xs text-tx-muted">{format(new Date(a.at), 'EEE, MMM d')} · {a.sub}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className="grid grid-cols-2 gap-2">
        <LinkTile to="/train/history" icon={History} title="History" sub="Every session" />
        <LinkTile to="/stats?tab=training" icon={BarChart3} title="Training trends" sub="Volume, PRs, coverage" />
        <LinkTile to="/exercises" icon={Library} title="Exercise library" sub="Browse and add" />
        <LinkTile to="/train/schedule" icon={CalendarRange} title="Schedule" sub="Weekly pattern, calendar" />
      </section>

      <TrainSheet
        isOpen={showSheet}
        onClose={() => setShowSheet(false)}
        today={todayPending}
        onLogCardio={() => { setShowSheet(false); setShowCardio(true) }}
      />
      <GoalsSheet isOpen={showGoals} goals={goals} onClose={() => setShowGoals(false)} onSaved={setGoals} />
      {showCardio && <QuickCardioModal onClose={() => setShowCardio(false)} onLogged={() => { setShowCardio(false); setNow(new Date()) }} />}
    </div>
  )
}

function DayCell({ day: d }: { day: TrainDay }) {
  const ring = {
    done: 'bg-train text-[#0a0b0f]',
    partial: 'bg-train/30 text-train',
    extra: 'bg-move/25 text-move',
    missed: 'bg-heart/15 text-heart',
    planned: 'border border-dashed border-train/60 text-train',
    rest: 'bg-surface-overlay text-tx-faint',
  }[d.status]
  const Icon = d.status === 'done' || d.status === 'extra' || d.status === 'partial' ? Check : d.status === 'missed' ? X : Circle
  // With a daily stretch routine on the schedule, every day's first entry
  // would read "Morning Mobility" — label the day by its main session instead.
  const main = d.planned.find(p => p.kind !== 'mobility') ?? d.planned[0]
  const name = main?.name ?? (d.cardioMinutes ? 'Cardio' : d.workouts[0]?.name ?? '')
  return (
    <div className={`flex flex-col items-center gap-1 rounded-xl py-1.5 min-w-0 ${d.isToday ? 'bg-surface-overlay' : ''}`}
      title={[
        d.planned.map(p => p.name).join(', '),
        d.kinds.strength.sessions ? `${d.kinds.strength.minutes} min lifting` : '',
        d.cardioMinutes ? `${d.cardioMinutes} min cardio` : '',
        d.kinds.mobility.sessions ? `${d.kinds.mobility.minutes} min stretching` : '',
      ].filter(Boolean).join(' · ') || 'Rest'}>
      <span className={`text-[10px] font-semibold uppercase ${d.isToday ? 'text-tx-primary' : 'text-tx-muted'}`}>{d.label}</span>
      <span className={`w-8 h-8 rounded-full flex items-center justify-center ${ring}`}>
        <Icon className={d.status === 'rest' || d.status === 'planned' ? 'w-2.5 h-2.5' : 'w-4 h-4'} strokeWidth={2.5} />
      </span>
      <span className="text-[9px] leading-tight text-tx-muted truncate w-full text-center px-0.5">{name || 'Rest'}</span>
      {/* One dot per type: filled = done, ring = planned and not yet done. */}
      <span className="flex items-center gap-[3px]" aria-hidden>
        {MODALITIES.map(m => {
          const done = d.kinds[m].sessions > 0
          const planned = d.planned.some(p => p.kind === m || (p.kind === 'mixed' && m === 'strength'))
          return (
            <span key={m} className={`w-1.5 h-1.5 rounded-full ${done ? KIND_META[m].bg : planned ? `border ${KIND_META[m].text} border-current` : 'bg-surface-overlay'}`} />
          )
        })}
      </span>
      {d.cardioMinutes > 0 && <span className="text-[9px] text-move tabular-nums leading-none">{d.cardioMinutes}m</span>}
    </div>
  )
}

function KindLegend() {
  return (
    <div className="flex items-center justify-center gap-3 mt-2 text-[10px] text-tx-muted">
      {MODALITIES.map(m => (
        <span key={m} className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${KIND_META[m].bg}`} />{KIND_META[m].label}
        </span>
      ))}
    </div>
  )
}

function ActivityIcon({ kind }: { kind: types.TrainingKind }) {
  const m = KIND_META[kind]
  return (
    <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.tint}`}>
      <m.icon className="w-4 h-4" />
    </span>
  )
}

function WeekStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-tx-primary tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-tx-muted">{label}</p>
    </div>
  )
}

function LinkTile({ to, icon: Icon, title, sub }: { to: string; icon: React.ElementType; title: string; sub: string }) {
  return (
    <Link to={to} className="card-interactive flex items-center gap-3 p-3.5">
      <Icon className="w-5 h-5 text-train flex-shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-tx-primary truncate">{title}</span>
        <span className="block text-[11px] text-tx-muted truncate">{sub}</span>
      </span>
    </Link>
  )
}

function cardioLabel(type: string): string {
  const t = type.replace(/_/g, ' ').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}
