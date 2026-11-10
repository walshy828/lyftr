import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format, startOfWeek, addDays, parseISO } from 'date-fns'
import {
  Play, Plus, Footprints, Check, X, Circle, Dumbbell, Trophy, CalendarRange, Sparkles,
  Library, List, ChevronRight, Timer,
} from 'lucide-react'
import { scheduleAPI, workoutAPI, cardioAPI, programAPI, trainingAPI } from '../services/api'
import { useWorkoutSession } from '../stores/workoutSession'
import { useSettingsStore, displayWeight, weightShort } from '../stores/settings'
import { buildTrainWeek, goalProgress, nextSession, type TrainDay } from '../utils/trainWeek'
import { KIND_META, MODALITIES, kindsOf } from '../utils/trainingKinds'
import { GoalBars, GoalsSheet } from '../components/training/TrainingGoals'
import QuickCardioModal from '../components/QuickCardioModal'
import Loading from '../components/Loading'
import * as types from '../types'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/**
 * Train — the gym-day screen. What's planned this week and how it's going,
 * the next session ready to start, recent PRs and activity. Building routines
 * and editing the weekly pattern is rarer, so it sits one level down under
 * "Build" rather than taking the first screen.
 */
export default function Train() {
  const navigate = useNavigate()
  const { session } = useWorkoutSession()
  const { settings } = useSettingsStore()
  const [now] = useState(() => new Date())
  const [schedule, setSchedule] = useState<types.ScheduledDay[]>([])
  const [workouts, setWorkouts] = useState<types.Workout[]>([])
  const [cardio, setCardio] = useState<types.CardioSession[]>([])
  const [prs, setPrs] = useState<types.RecentPR[]>([])
  const [routineCount, setRoutineCount] = useState<number | null>(null)
  const [next, setNext] = useState<types.Program | null>(null)
  const [typeDays, setTypeDays] = useState<types.TrainingTypeDay[]>([])
  const [goals, setGoals] = useState<types.TrainingGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [showCardio, setShowCardio] = useState(false)
  const [showGoals, setShowGoals] = useState(false)

  useEffect(() => {
    const start = startOfWeek(now, { weekStartsOn: 1 })
    Promise.all([
      // Two weeks, so "next session" can roll into next week on a Sunday.
      scheduleAPI.range(iso(start), iso(addDays(start, 13))).then(r => r.days).catch(() => []),
      workoutAPI.list({ limit: 30 }).catch(() => []),
      cardioAPI.list({ limit: 30 }).catch(() => []),
      workoutAPI.prs(5).catch(() => []),
      programAPI.list({ limit: 100 }).catch(() => null),
      trainingAPI.days(iso(start), iso(addDays(start, 6))).catch(() => []),
      trainingAPI.goals().catch(() => []),
    ]).then(([s, w, c, p, progs, td, g]) => {
      setSchedule(s); setWorkouts(w); setCardio(c); setPrs(p)
      setRoutineCount(progs ? progs.length : null)
      setTypeDays(td); setGoals(g)
    }).finally(() => setLoading(false))
  }, [now])

  const week = useMemo(() => buildTrainWeek(now, schedule, workouts, cardio, typeDays), [now, schedule, workouts, cardio, typeDays])
  const progress = useMemo(() => goalProgress(week.byKind, goals), [week, goals])
  const upNext = useMemo(() => nextSession(schedule, iso(now)), [schedule, now])

  useEffect(() => {
    if (!upNext) { setNext(null); return }
    programAPI.get(upNext.programId).then(setNext).catch(() => setNext(null))
  }, [upNext])

  const activity = useMemo(() => {
    const rows = [
      ...workouts.map(w => ({ source: 'workout' as const, kind: w.kind ?? kindsOf(w.kind, w.exercises?.map(e => e.exercise))[0], id: w.id, at: w.started_at, title: w.name, sub: `${w.exercises?.length ?? 0} exercises · ${Math.round(w.duration / 60)} min` })),
      ...cardio.map(c => ({ source: 'synced' as const, kind: 'cardio' as const, id: c.id, at: c.started_at, title: c.title || cardioLabel(c.activity_type), sub: `${Math.round(c.duration_seconds / 60)} min${c.distance_meters ? ` · ${(c.distance_meters / 1609.34).toFixed(1)} mi` : ''}` })),
    ]
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
  }, [workouts, cardio])

  if (loading) return <Loading />

  const unit = weightShort(settings.weight_unit)
  const nextLabel = upNext
    ? upNext.date === iso(now) ? 'Today' : format(parseISO(upNext.date), 'EEEE')
    : null

  return (
    <div className="space-y-4 animate-slide-up">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Week of {format(startOfWeek(now, { weekStartsOn: 1 }), 'MMM d')}</p>
          <h1 className="font-display font-bold text-[26px] leading-tight text-tx-primary mt-0.5">Train</h1>
        </div>
        <Link to="/plan/schedule" className="btn-secondary btn-sm"><CalendarRange className="w-3.5 h-3.5" /> Schedule</Link>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => navigate(session ? '/workout/active' : '/workout/start')} className="btn-primary btn-md">
          {session ? <><Timer className="w-4 h-4" /> Resume</> : <><Play className="w-4 h-4" /> Start</>}
        </button>
        <button onClick={() => navigate('/workouts/new')} className="btn-secondary btn-md"><Plus className="w-4 h-4" /> Log</button>
        <button onClick={() => setShowCardio(true)} className="btn-secondary btn-md"><Footprints className="w-4 h-4" /> Cardio</button>
      </div>

      {/* This week */}
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
      </div>

      {goals.length > 0 && (
        <div className="card p-4">
          <GoalBars progress={progress} onEdit={() => setShowGoals(true)} />
        </div>
      )}

      {/* Up next */}
      {upNext ? (
        <div className="card overflow-hidden">
          <div className="p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Up next · {nextLabel}</p>
              <p className="text-lg font-bold text-tx-primary truncate mt-0.5">{upNext.name}</p>
              {next && <p className="text-xs text-tx-muted">{next.exercises.length} exercises · {next.exercises.reduce((s, e) => s + e.sets.length, 0)} sets</p>}
            </div>
            <button onClick={() => navigate(`/workout/start?program=${upNext.programId}`)} className="btn-primary btn-md flex-shrink-0">
              <Play className="w-4 h-4" /> Start
            </button>
          </div>
          {next && next.exercises.length > 0 && (
            <ul className="border-t border-surface-border divide-y divide-surface-border">
              {next.exercises.slice(0, 5).map(ex => {
                const top = ex.sets.reduce((m, s) => Math.max(m, s.target_weight || 0), 0)
                const reps = ex.sets[0]?.target_reps
                return (
                  <li key={ex.id ?? ex.exercise_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-sm text-tx-secondary truncate">{ex.exercise?.name}</span>
                    <span className="text-xs text-tx-muted tabular-nums flex-shrink-0">
                      {ex.sets.length}×{reps || '—'}{top > 0 ? ` @ ${displayWeight(top, settings.weight_unit)} ${unit}` : ''}
                    </span>
                  </li>
                )
              })}
              {next.exercises.length > 5 && (
                <li className="px-4 py-2 text-xs text-tx-muted">+{next.exercises.length - 5} more</li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <Link to="/plan/schedule" className="card-interactive flex items-center gap-3 p-4">
          <CalendarRange className="w-5 h-5 text-train flex-shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-tx-primary">Nothing scheduled</span>
            <span className="block text-xs text-tx-muted">Put routines on days of the week and they'll show up here, ready to start.</span>
          </span>
          <ChevronRight className="w-4 h-4 text-tx-muted" />
        </Link>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* PRs */}
        <div className="card p-4">
          <p className="eyebrow mb-2 flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-fuel" /> Recent PRs</p>
          {prs.length === 0 ? (
            <p className="text-sm text-tx-muted py-2">PRs show up here as you beat your best sets.</p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {prs.map(pr => (
                <li key={`${pr.exercise_id}-${pr.date}`}>
                  <Link to={`/workouts/${pr.workout_id}`} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-tx-primary truncate">{pr.exercise_name}</span>
                      <span className="block text-xs text-tx-muted">{format(parseISO(pr.date), 'MMM d')} · e1RM {displayWeight(pr.estimated_1rm, settings.weight_unit)} {unit}</span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-tx-primary flex-shrink-0">
                      {displayWeight(pr.weight, settings.weight_unit)} × {pr.reps}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent activity — lifts and synced cardio together */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="eyebrow">Recent activity</p>
            <Link to="/workouts" className="text-xs text-brand-400">All workouts</Link>
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
      </div>

      {/* Build — the less frequent work, one tap down */}
      <section>
        <p className="eyebrow mb-2 px-0.5">Build</p>
        <div className="grid grid-cols-2 gap-2">
          <BuildTile to="/plan/schedule" icon={CalendarRange} title="Schedule" sub={routineCount === null ? 'Weekly pattern' : `Week + ${routineCount} routine${routineCount === 1 ? '' : 's'}`} />
          <BuildTile to="/programs/new" icon={Plus} title="New routine" sub="Lift, cardio or stretch" />
          <BuildTile to="/programs/ai-new" icon={Sparkles} title="Create with AI" sub="From your goals" />
          <BuildTile to="/exercises" icon={Library} title="Exercise library" sub="Browse and add" />
          <BuildTile to="/workouts" icon={List} title="Workout history" sub="Every session" />
          <BuildTile to="/stats?tab=training" icon={Trophy} title="Training trends" sub="Volume, PRs, coverage" />
        </div>
      </section>

      <GoalsSheet isOpen={showGoals} goals={goals} onClose={() => setShowGoals(false)} onSaved={setGoals} />
      {showCardio && <QuickCardioModal onClose={() => setShowCardio(false)} onLogged={() => setShowCardio(false)} />}
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

function BuildTile({ to, icon: Icon, title, sub }: { to: string; icon: React.ElementType; title: string; sub: string }) {
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
