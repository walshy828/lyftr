import { useState } from 'react'
import { AlertCircle, Bike, Footprints, Waves, RotateCw, Trash2, Timer, MapPin, HeartPulse, Flame, Activity, Zap, ArrowUpFromDot } from 'lucide-react'
import { format } from 'date-fns'
import Loading from '../Loading'
import { useServerInfiniteList } from '../../hooks/useServerInfiniteList'
import { cardioAPI } from '../../services/api'
import * as types from '../../types'

const ACTIVITY_ICONS: Record<string, typeof Footprints> = {
  running: Footprints,
  walking: Footprints,
  cycling: Bike,
  swimming: Waves,
  rowing: RotateCw,
  elliptical: RotateCw,
  hiit: Zap,
  stair_climbing: ArrowUpFromDot,
  // Fitbit tags most sessions "Other workout" rather than a specific sport —
  // see android/phone/.../HealthConnectSync.kt cardioActivityTypeOf.
  workout: Activity,
}

const ACTIVITY_LABELS: Record<string, string> = {
  running: 'Run',
  walking: 'Walk',
  cycling: 'Ride',
  swimming: 'Swim',
  rowing: 'Row',
  elliptical: 'Elliptical',
  hiit: 'HIIT',
  stair_climbing: 'Stair climbing',
  workout: 'Workout',
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDistance(meters: number): string {
  if (meters <= 0) return ''
  return `${(meters / 1000).toFixed(2)} km`
}

/**
 * Cardio sessions arrive read-only from a companion device (Health Connect via
 * the Android app, see android/phone/.../health/HealthConnectSync.kt) — there
 * is no manual log form here, only history + delete.
 */
export default function CardioPanel() {
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { items, sentinelRef, hasMore, loading, initialLoading, reload } =
    useServerInfiniteList<types.CardioSession>({
      fetcher: (offset, limit) => cardioAPI.list({ offset, limit }),
    })

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      await cardioAPI.delete(id)
      reload()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to delete session')
    } finally {
      setDeletingId(null)
    }
  }

  if (initialLoading) return <Loading />

  if (items.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-tx-secondary font-medium">No cardio sessions yet</p>
        <p className="text-xs text-tx-muted mt-1">
          Runs, rides, and other cardio recorded on your watch sync here automatically once the
          Lyftr companion app is connected to Health Connect.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="alert-error" role="alert" aria-live="polite">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <h2 className="section-title px-1">History</h2>
      <div className="space-y-2">
        {items.map(session => {
          const Icon = ACTIVITY_ICONS[session.activity_type] ?? Footprints
          const label = ACTIVITY_LABELS[session.activity_type] ?? session.activity_type
          return (
            <div key={session.id} className="card flex items-center p-4 gap-3">
              <div className="w-11 h-11 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-brand-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-tx-primary">{label}</p>
                  <span className="text-xs text-tx-muted">
                    {format(new Date(session.started_at), 'MMM d, yyyy · h:mm a')}
                  </span>
                </div>
                <div className="flex items-center gap-x-3 mt-1 text-xs text-tx-muted flex-wrap">
                  <span className="flex items-center gap-1"><Timer className="w-3 h-3" />{formatDuration(session.duration_seconds)}</span>
                  {session.distance_meters > 0 && (
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{formatDistance(session.distance_meters)}</span>
                  )}
                  {session.avg_heart_rate > 0 && (
                    <span className="flex items-center gap-1"><HeartPulse className="w-3 h-3" />{session.avg_heart_rate} bpm</span>
                  )}
                  {session.calories > 0 && (
                    <span className="flex items-center gap-1"><Flame className="w-3 h-3" />{Math.round(session.calories)} cal</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(session.id)}
                disabled={deletingId === session.id}
                className="p-2 hover:bg-error-500/10 rounded-lg transition-colors flex-shrink-0"
                aria-label="Delete session"
              >
                <Trash2 className="w-4 h-4 text-error-400" />
              </button>
            </div>
          )
        })}
      </div>
      <div ref={sentinelRef} />
      {hasMore && loading && (
        <p className="text-center text-xs text-tx-muted py-2">Loading more…</p>
      )}
    </div>
  )
}
