import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { format, startOfWeek, subDays, isAfter, isBefore } from 'date-fns'
import { Dumbbell, Plus, Play, Clock, Search, AlertCircle, Edit2, Trash2, TrendingUp, TrendingDown, Minus, ChevronRight, MoreVertical } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Loading from '../components/Loading'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import PeriodSelector from '../components/PeriodSelector'
import { FeelingBadge, FocusBadge } from '../components/WorkoutBadges'
import { useServerInfiniteList } from '../hooks/useServerInfiniteList'
import { workoutAPI } from '../services/api'
import { useSettingsStore, weightShort, displayVolume } from '../stores/settings'
import { useWorkoutSession } from '../stores/workoutSession'
import * as types from '../types'
import { muscleColor } from '../utils/exerciseUtils'

const PERIODS = ['7d', '30d', '90d', 'All'] as const
type Period = typeof PERIODS[number]
const PERIOD_DAYS: Record<Period, number | null> = { '7d': 7, '30d': 30, '90d': 90, 'All': null }

function WorkoutCard({ workout, onEdit, onDelete }: { workout: types.Workout; onEdit: (id: number) => void; onDelete: (id: number) => void }) {
  const navigate = useNavigate()
  const { settings } = useSettingsStore()
  const wUnit = weightShort(settings.weight_unit)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const inMenu = menuRef.current?.contains(e.target as Node)
      const inPortal = portalRef.current?.contains(e.target as Node)
      if (!inMenu && !inPortal) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const startedAt = new Date(workout.started_at)
  const durationMin = Math.round(workout.duration / 60)
  const totalVolume = displayVolume(
    workout.exercises?.reduce((total, e) =>
      total + (e.sets?.reduce((s, set) => s + (set.reps || 0) * (set.weight || 0), 0) || 0), 0) || 0,
    wUnit
  )

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await workoutAPI.delete(workout.id)
      onDelete(workout.id)
    } catch {
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="card overflow-hidden border-error-500/30">
        <div className="flex items-center justify-between p-4 bg-error-500/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-error-500/10 border border-error-500/20 flex items-center justify-center flex-shrink-0">
              <Trash2 className="w-4 h-4 text-error-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-tx-primary">Delete "{workout.name}"?</p>
              <p className="text-xs text-tx-muted">This cannot be undone</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setConfirming(false)} className="btn-secondary btn-sm">
              Cancel
            </button>
            <button onClick={handleDelete} disabled={deleting} className="btn-danger-solid btn-sm disabled:opacity-50">
              <Trash2 className="w-3 h-3" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card group active:scale-[0.99] transition-transform">
      <div className="flex items-center p-4 gap-3">
        {/* Day/date tile — tappable, navigates to detail */}
        <button
          onClick={() => navigate(`/workouts/${workout.id}`)}
          className="flex-1 flex items-center gap-3 min-w-0 text-left"
        >
          <div className="w-12 h-12 rounded-xl bg-brand-500/10 border border-brand-500/20 flex flex-col items-center justify-center flex-shrink-0 leading-none">
            <span className="text-[9px] font-bold text-brand-500 uppercase tracking-wide">{format(startedAt, 'EEE')}</span>
            <span className="text-base font-bold text-tx-primary mt-0.5">{format(startedAt, 'd')}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-tx-primary whitespace-nowrap">{format(startedAt, 'MMM d, yyyy')}</p>
            <div className="flex items-center gap-2 mt-0.5 min-w-0">
              <p className="text-xs text-tx-muted truncate">{workout.name}</p>
              <FocusBadge workout={workout} />
            </div>
            <div className="flex items-center gap-x-2 mt-1 min-w-0 overflow-hidden">
              {durationMin > 0 && (
                <span className="flex items-center gap-1 text-xs text-tx-muted whitespace-nowrap">
                  <Clock className="w-3 h-3 flex-shrink-0" />{durationMin} min
                </span>
              )}
              {durationMin > 0 && <span className="text-tx-muted/40 text-xs">·</span>}
              <span className="text-xs text-tx-muted whitespace-nowrap">{workout.exercises?.length || 0} exercises</span>
              {totalVolume > 0 && (
                <>
                  <span className="text-tx-muted/40 text-xs">·</span>
                  <span className="flex items-center gap-1 text-xs text-tx-muted whitespace-nowrap">
                    <TrendingUp className="w-3 h-3 flex-shrink-0" />{totalVolume.toLocaleString()} {wUnit}
                  </span>
                </>
              )}
              {workout.feeling ? <span className="text-tx-muted/40 text-xs">·</span> : null}
              <FeelingBadge feeling={workout.feeling} />
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-tx-muted flex-shrink-0" />
        </button>

        {/* Mobile: kebab menu | Desktop: hover icons */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          {/* Mobile kebab trigger */}
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
            className={`sm:hidden p-2 rounded-lg transition-colors ${menuOpen ? 'bg-surface-muted' : 'hover:bg-surface-muted'}`}
            aria-label="Options"
          >
            <MoreVertical className="w-4 h-4 text-tx-muted" />
          </button>

          {/* Centered modal dropdown — portal to escape transform stacking context */}
          {menuOpen && createPortal(
            <>
              <div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
                onClick={e => { e.stopPropagation(); setMenuOpen(false) }}
              />
              <div ref={portalRef} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 bg-surface-overlay border border-surface-border/60 rounded-2xl shadow-2xl z-50 overflow-hidden">
                <div className="px-4 pt-4 pb-3">
                  <p className="text-[10px] font-semibold text-tx-muted uppercase tracking-wider text-center">Workout</p>
                  <p className="text-sm font-semibold text-tx-primary text-center mt-0.5 truncate">{workout.name}</p>
                </div>
                <div className="border-t border-surface-border/40 py-1.5">
                  <button
                    onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(workout.id) }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-tx-primary hover:bg-surface-muted/60 active:bg-surface-muted transition-colors"
                  >
                    <div className="w-8 h-8 rounded-xl bg-brand-500/10 flex items-center justify-center flex-shrink-0">
                      <Edit2 className="w-4 h-4 text-brand-500" />
                    </div>
                    Edit Workout
                  </button>
                  <div className="mx-4 border-t border-surface-border/30" />
                  <button
                    onClick={e => { e.stopPropagation(); setMenuOpen(false); setConfirming(true) }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-error-400 hover:bg-error-500/10 active:bg-error-500/15 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-xl bg-error-500/10 flex items-center justify-center flex-shrink-0">
                      <Trash2 className="w-4 h-4 text-error-400" />
                    </div>
                    Delete Workout
                  </button>
                </div>
                <div className="border-t border-surface-border/40 p-3">
                  <button
                    onClick={e => { e.stopPropagation(); setMenuOpen(false) }}
                    className="w-full py-2.5 text-sm font-semibold text-tx-muted bg-surface-muted/60 hover:bg-surface-muted rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>,
            document.body
          )}

          {/* Desktop hover icons */}
          <div className="hidden sm:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); onEdit(workout.id) }}
              className="p-2 hover:bg-surface-muted rounded-lg transition-colors"
            >
              <Edit2 className="w-4 h-4 text-brand-500" />
            </button>
            <button
              aria-label="Delete"
              onClick={e => { e.stopPropagation(); setConfirming(true) }}
              className="p-2 hover:bg-error-500/10 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4 text-error-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Workouts() {
  const navigate = useNavigate()
  const { session } = useWorkoutSession()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [period, setPeriod] = useState<Period>('30d')
  const [error, setError] = useState<string | null>(null)

  // Debounce search so we don't fire a request on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { items: workouts, sentinelRef, hasMore, loading, initialLoading, reload } = useServerInfiniteList<types.Workout>({
    fetcher: (offset, limit) => workoutAPI.list({ offset, limit, q: debouncedSearch || undefined }),
    deps: [debouncedSearch],
  })

  if (initialLoading) return <Loading />

  if (error) {
    return (
      <div className="alert-error">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const lastWeekStart = subDays(weekStart, 7)
  const thisWeek = workouts.filter(w => isAfter(new Date(w.started_at), weekStart))
  const lastWeek = workouts.filter(w => {
    const d = new Date(w.started_at)
    return !isBefore(d, lastWeekStart) && isBefore(d, weekStart)
  })
  const weekDelta = thisWeek.length - lastWeek.length
  const thisWeekIds = new Set(thisWeek.map(w => w.id))
  const periodDays = PERIOD_DAYS[period]
  const periodCutoff = periodDays != null ? subDays(new Date(), periodDays) : null
  const historical = workouts
    .filter(w => !thisWeekIds.has(w.id))
    .filter(w => !periodCutoff || isAfter(new Date(w.started_at), periodCutoff))

  return (
    <div className="space-y-5 animate-slide-up">
      <PageHeader
        title="Workouts"
        subtitle="Track and review your training sessions"
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/workouts/new')} className="btn-secondary btn-sm">
              <Plus className="w-4 h-4" /> Log Workout
            </button>
            <button onClick={() => navigate('/workout/start')} className="btn-primary btn-sm">
              <Play className="w-4 h-4" /> {session ? 'Resume' : 'Start'}
            </button>
          </div>
        }
      />

      {/* Summary — this week vs last week trend */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="stat-label truncate">This Week</span>
          </div>
          <div className="flex items-end gap-1 min-w-0">
            <span className="stat-value text-xl">{thisWeek.length}</span>
            <span className="text-xs text-tx-muted mb-0.5 truncate">sessions</span>
          </div>
          {lastWeek.length > 0 || thisWeek.length > 0 ? (
            <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${
              weekDelta > 0 ? 'text-success-500' : weekDelta < 0 ? 'text-error-400' : 'text-tx-muted'
            }`}>
              {weekDelta > 0 ? <TrendingUp className="w-3 h-3 flex-shrink-0" /> : weekDelta < 0 ? <TrendingDown className="w-3 h-3 flex-shrink-0" /> : <Minus className="w-3 h-3 flex-shrink-0" />}
              <span className="truncate">{weekDelta === 0 ? 'same as' : `${weekDelta > 0 ? '+' : ''}${weekDelta} vs`} last wk</span>
            </div>
          ) : null}
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="stat-label truncate">Last Week</span>
          </div>
          <div className="flex items-end gap-1 min-w-0">
            <span className="stat-value text-xl">{lastWeek.length}</span>
            <span className="text-xs text-tx-muted mb-0.5 truncate">sessions</span>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="stat-label truncate">Avg Time</span>
          </div>
          <div className="flex items-end gap-1 min-w-0">
            <span className="stat-value text-xl">{workouts.length > 0 ? Math.round(workouts.reduce((sum, w) => sum + w.duration, 0) / workouts.length / 60) : 0}</span>
            <span className="text-xs text-tx-muted mb-0.5 truncate">min</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-tx-muted pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input pl-10"
          placeholder="Search workouts…"
        />
      </div>

      {workouts.length === 0 && !loading ? (
        <EmptyState
          icon={Dumbbell}
          title="No workouts found"
          subtitle={search ? 'Try a different search' : 'Log a workout to get started'}
        />
      ) : (
        <>
          {/* This Week */}
          <div className="space-y-2">
            <h2 className="text-xs font-semibold text-tx-muted uppercase tracking-wider px-0.5">This Week</h2>
            {thisWeek.length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                title="No workouts yet this week"
                subtitle="Let's fix that"
              />
            ) : (
              thisWeek.map(w => <WorkoutCard key={w.id} workout={w}
                onEdit={(id) => navigate(`/workouts/${id}/edit`)}
                onDelete={() => reload()}
              />)
            )}
          </div>

          {/* Historical */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <h2 className="text-xs font-semibold text-tx-muted uppercase tracking-wider">Historical</h2>
              <PeriodSelector options={PERIODS} value={period} onChange={setPeriod} />
            </div>
            {historical.length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                title="No historical workouts"
                subtitle="Try a wider time period"
              />
            ) : (
              historical.map(w => <WorkoutCard key={w.id} workout={w}
                onEdit={(id) => navigate(`/workouts/${id}/edit`)}
                onDelete={() => reload()}
              />)
            )}
            <div ref={sentinelRef} />
            {hasMore && loading && (
              <p className="text-center text-xs text-tx-muted py-2">Loading more…</p>
            )}
          </div>
        </>
      )}

    </div>
  )
}
