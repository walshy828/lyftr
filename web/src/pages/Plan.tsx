import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, CalendarDays, Check, Play, RotateCcw, X, Plus, Dumbbell, Sparkles, Search, Footprints,
} from 'lucide-react'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths,
  eachDayOfInterval, isSameMonth, isToday, isSameDay, parseISO,
} from 'date-fns'
import { scheduleAPI, programAPI } from '../services/api'
import { useWorkoutSession } from '../stores/workoutSession'
import { PageHeader } from '../components/ui'
import ProgramCard from '../components/ProgramCard'
import PlanDaySheet from '../components/PlanDaySheet'
import QuickCardioModal from '../components/QuickCardioModal'
import Loading from '../components/Loading'
import * as types from '../types'

// Monday-start, matching the consistency heatmap and every week calculation in
// dashboardMetrics.
const WEEK_OPTS = { weekStartsOn: 1 as const }
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
// Column order is Monday-first for display; the API speaks Go's time.Weekday,
// where 0 is Sunday.
const WEEKDAY_NUMS = [1, 2, 3, 4, 5, 6, 0]

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export default function Plan() {
  const navigate = useNavigate()
  const { session } = useWorkoutSession()
  const [showQuickCardio, setShowQuickCardio] = useState(false)
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [data, setData] = useState<types.ScheduleResponse | null>(null)
  const [programs, setPrograms] = useState<types.Program[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [openDay, setOpenDay] = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [routineSearch, setRoutineSearch] = useState('')

  // The grid always shows whole weeks, so it spills into the neighbouring
  // months — fetch the visible range, not the calendar month.
  const gridStart = useMemo(() => startOfWeek(startOfMonth(month), WEEK_OPTS), [month])
  const gridEnd = useMemo(() => endOfWeek(endOfMonth(month), WEEK_OPTS), [month])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await scheduleAPI.range(iso(gridStart), iso(gridEnd))
      setData(res)
      setError('')
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load schedule')
    } finally {
      setLoading(false)
    }
  }, [gridStart, gridEnd])

  const loadPrograms = useCallback(() => {
    programAPI.list({ limit: 100 }).then(setPrograms).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadPrograms() }, [loadPrograms])

  const byDate = useMemo(
    () => new Map((data?.days ?? []).map(d => [d.date, d])),
    [data],
  )

  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  )

  // Filtered display-only: the day sheet and "just this day" overrides still
  // need the full, unfiltered `programs` list to resolve assignments.
  const visibleRoutines = useMemo(() => {
    const q = routineSearch.trim().toLowerCase()
    if (!q) return programs
    return programs.filter(p => p.name.toLowerCase().includes(q))
  }, [programs, routineSearch])

  const mutate = async (fn: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await fn()
      await load()
      setError('')
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not save that change')
    } finally {
      setSaving(false)
    }
  }

  const recurringIds = (weekday: number): number[] =>
    (data?.recurring?.[String(weekday)] ?? []).map(s => s.program_id)

  const replaceWeekday = (weekday: number, ids: number[]) => {
    const recurring = data?.recurring ?? {}
    const next: Record<string, number[]> = {}
    for (const [k, list] of Object.entries(recurring)) {
      next[k] = list.map(p => p.program_id)
    }
    next[String(weekday)] = ids
    return mutate(() => scheduleAPI.replace(next))
  }

  const toggleRecurring = (weekday: number, programId: number) => {
    const current = recurringIds(weekday)
    const next = current.includes(programId)
      ? current.filter(id => id !== programId)
      : [...current, programId]
    return replaceWeekday(weekday, next)
  }

  const selected = selectedDate ? byDate.get(selectedDate) : null

  if (loading && !data) return <Loading />

  return (
    <div className="space-y-4 animate-slide-up">
      <PageHeader
        title="Plan"
        subtitle="Your weekly routine"
        action={
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={() => navigate('/exercises')} className="btn-ghost btn-sm flex-1 sm:flex-none">
              <Dumbbell className="w-4 h-4" /> Exercises
            </button>
            <button onClick={() => navigate('/programs/ai-new')} className="btn-ghost btn-sm flex-1 sm:flex-none">
              <Sparkles className="w-4 h-4" /> AI Routine
            </button>
          </div>
        }
      />

      {error && <div className="alert-error text-sm">{error}</div>}

      {/* Log something right now — no need to go through a routine or the
          weekly pattern for an ad-hoc session. */}
      <div className="flex items-center gap-2">
        <button onClick={() => setShowQuickCardio(true)} className="btn-secondary btn-sm flex-1">
          <Footprints className="w-4 h-4" /> Cardio
        </button>
        <button onClick={() => navigate('/workouts/new')} className="btn-secondary btn-sm flex-1 min-w-0">
          <Plus className="w-4 h-4" />
          <span><span className="hidden sm:inline">Log </span>Workout</span>
        </button>
        <button onClick={() => navigate('/workout/start')} className="btn-primary btn-sm flex-1">
          <Play className="w-4 h-4" /> {session ? 'Resume' : 'Start'}
        </button>
      </div>

      {showQuickCardio && <QuickCardioModal onClose={() => setShowQuickCardio(false)} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Week schedule — the weekly pattern that actually repeats. */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-brand-400" />
            <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider">Week schedule</p>
          </div>
          <div className="space-y-1.5">
            {WEEKDAY_NUMS.map((weekday, i) => {
              const slots = data?.recurring?.[String(weekday)] ?? []
              return (
                <button
                  key={weekday}
                  onClick={() => setOpenDay(weekday)}
                  className="w-full flex items-center justify-between gap-2 p-3 rounded-xl border border-surface-border bg-surface-muted/30 hover:border-brand-500/30 transition-colors text-left"
                >
                  <span className="text-sm font-medium text-tx-primary">{DAY_NAMES[i]}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    {slots.length === 0 ? (
                      <span className="text-xs text-tx-muted flex-shrink-0">Rest</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-brand-500/15 text-brand-300 border border-brand-500/25 truncate max-w-[10rem]">
                        {slots.map(s => s.name).join(', ')}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-tx-muted flex-shrink-0" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Routines — reusable templates you assign to days. */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider">Routines</p>
            <button onClick={() => navigate('/programs/new')} className="btn-secondary btn-sm">
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>

          {programs.length > 0 && (
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tx-muted pointer-events-none" />
              <input
                value={routineSearch}
                onChange={e => setRoutineSearch(e.target.value)}
                className="input pl-8 py-1.5 text-sm"
                placeholder="Search programs…"
              />
            </div>
          )}

          {programs.length === 0 ? (
            <p className="text-xs text-tx-muted py-2">No routines yet — create one to get started.</p>
          ) : visibleRoutines.length === 0 ? (
            <p className="text-xs text-tx-muted py-2">No routines match that search.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {visibleRoutines.map(p => (
                <ProgramCard key={p.id} program={p} variant="own" compact />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Month view — planned vs actually done, including previous weeks. */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setMonth(m => addMonths(m, -1))}
            aria-label="Previous month"
            className="p-1.5 rounded-lg hover:bg-surface-muted transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-tx-muted" />
          </button>
          <p className="text-sm font-semibold text-tx-primary">{format(month, 'MMMM yyyy')}</p>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            aria-label="Next month"
            className="p-1.5 rounded-lg hover:bg-surface-muted transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-tx-muted" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_LABELS.map(d => (
            <div key={d} className="text-[10px] text-tx-muted font-medium text-center">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map(day => {
            const key = iso(day)
            const entry = byDate.get(key)
            const planned = entry?.programs ?? []
            const done = planned.some(p => p.completed_workout_id)
            const outside = !isSameMonth(day, month)
            const isSelected = selectedDate === key
            return (
              <button
                key={key}
                onClick={() => setSelectedDate(isSelected ? null : key)}
                // A fixed min-height rather than aspect-square: square cells
                // scale with the container width, so on a desktop card they
                // become 120px-tall boxes with a number floating at the top.
                className={`min-h-[3.25rem] rounded-lg border p-1 flex flex-col items-center justify-start gap-0.5 transition-colors ${
                  isSelected ? 'border-brand-500 bg-brand-500/10' : 'border-transparent hover:border-surface-border'
                } ${outside ? 'opacity-35' : ''} ${isToday(day) ? 'ring-1 ring-brand-500/40' : ''}`}
              >
                <span className={`text-[11px] tabular-nums ${isToday(day) ? 'font-bold text-brand-400' : 'text-tx-secondary'}`}>
                  {format(day, 'd')}
                </span>
                {/* One dot per planned program; filled means it was done. */}
                {planned.length > 0 && (
                  <div className="flex items-center gap-0.5 flex-wrap justify-center">
                    {planned.slice(0, 3).map((p, i) => (
                      <span
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full ${
                          p.completed_workout_id ? 'bg-brand-500' : 'bg-brand-500/35'
                        }`}
                      />
                    ))}
                  </div>
                )}
                {done && <Check className="w-2.5 h-2.5 text-brand-500" />}
                {entry?.source === 'override' && !done && (
                  <span className="text-[8px] text-warning-400 leading-none">moved</span>
                )}
              </button>
            )
          })}
        </div>

        {selected && (
          <div className="mt-3 pt-3 border-t border-surface-border space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-tx-primary">
                {format(parseISO(selected.date), 'EEEE, MMMM d')}
                {isSameDay(parseISO(selected.date), new Date()) && (
                  <span className="ml-2 text-[10px] font-normal text-brand-400 uppercase tracking-wider">Today</span>
                )}
              </p>
              {selected.source === 'override' && (
                <button
                  disabled={saving}
                  onClick={() => mutate(() => scheduleAPI.clearOverride(selected.date))}
                  className="inline-flex items-center gap-1 text-xs text-tx-muted hover:text-tx-secondary disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" /> Reset to pattern
                </button>
              )}
            </div>

            {selected.programs.length === 0 ? (
              <p className="text-xs text-tx-muted">Rest day</p>
            ) : (
              <div className="space-y-1.5">
                {selected.programs.map(p => (
                  <div key={p.program_id} className="flex items-center gap-2">
                    <span className="text-sm text-tx-secondary flex-1 min-w-0 truncate">{p.name}</span>
                    <span className="text-xs text-tx-muted flex-shrink-0">{p.exercise_count} exercises</span>
                    {p.completed_workout_id ? (
                      <button
                        onClick={() => navigate(`/workouts/${p.completed_workout_id}`)}
                        className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 flex-shrink-0"
                      >
                        <Check className="w-3 h-3" /> Done
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/workout/start?program=${p.program_id}`)}
                        className="btn-secondary btn-sm flex-shrink-0"
                      >
                        <Play className="w-3 h-3" /> Start
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Per-date changes leave the weekly pattern alone. */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] text-tx-muted uppercase tracking-wider mr-1">Just this day</span>
              {programs.map(p => {
                const on = selected.programs.some(s => s.program_id === p.id)
                return (
                  <button
                    key={p.id}
                    disabled={saving}
                    onClick={() => {
                      const ids = on
                        ? selected.programs.filter(s => s.program_id !== p.id).map(s => s.program_id)
                        : [...selected.programs.map(s => s.program_id), p.id]
                      return mutate(() => scheduleAPI.setOverride(selected.date, ids))
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors disabled:opacity-50 ${
                      on
                        ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                        : 'bg-surface-muted/40 text-tx-muted border-transparent hover:border-surface-border'
                    }`}
                  >
                    {on ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {openDay !== null && (
        <PlanDaySheet
          isOpen={openDay !== null}
          onClose={() => setOpenDay(null)}
          dayLabel={DAY_NAMES[WEEKDAY_NUMS.indexOf(openDay)]}
          programs={programs}
          assignedIds={recurringIds(openDay)}
          saving={saving}
          onToggleProgram={pid => toggleRecurring(openDay, pid)}
          onSetRest={() => replaceWeekday(openDay, [])}
        />
      )}
    </div>
  )
}
