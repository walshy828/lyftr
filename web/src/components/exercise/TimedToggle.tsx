import { useState } from 'react'
import { Timer } from 'lucide-react'
import { exerciseAPI } from '../../services/api'
import * as types from '../../types'

interface Props {
  exercise: types.Exercise
  /** Called with the server's updated exercise after a successful toggle/edit. */
  onUpdated: (exercise: types.Exercise) => void
}

/**
 * Marks ANY exercise (custom or library) as timed or not, with a default hold
 * duration. Unlike the rest of an exercise's fields (name, muscle group,
 * etc.), this is allowed on library exercises too — many opengym-sourced
 * exercises (e.g. "Ankle Circles") are inherently timed holds/stretches, and
 * marking them so is a permanent, library-wide correction, not a per-workout
 * override. Shared by the exercise picker/detail views, Gym Mode, and the
 * Program/manual-workout editors.
 */
export default function TimedToggle({ exercise, onUpdated }: Props) {
  const [saving, setSaving] = useState(false)
  const [duration, setDuration] = useState(exercise.default_duration_seconds || 30)

  const save = async (isTimed: boolean, defaultDurationSeconds: number) => {
    setSaving(true)
    try {
      const updated = await exerciseAPI.setTimed(exercise.id, isTimed, defaultDurationSeconds)
      onUpdated(updated)
    } catch {
      // best-effort — leave the toggle as the user left it; a retry (toggling
      // again) is the natural recovery, no dedicated error UI for this small control
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-4">
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={!!exercise.is_timed}
          disabled={saving}
          onChange={e => save(e.target.checked, duration)}
          className="w-4 h-4 rounded accent-brand-500"
        />
        <Timer className="w-4 h-4 text-tx-muted" />
        <span className="text-sm text-tx-secondary">Timed exercise (e.g. a hold or stretch)</span>
      </label>
      {exercise.is_timed && (
        <label className="flex items-center gap-2 mt-3 pl-6">
          <span className="text-xs font-medium text-tx-muted">Default hold duration</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={duration}
            disabled={saving}
            onChange={e => setDuration(Math.max(1, Math.round(Number(e.target.value) || 0)))}
            onBlur={() => save(true, duration)}
            className="input text-sm text-center py-1.5 w-20"
            aria-label="Default hold duration in seconds"
          />
          <span className="text-xs text-tx-muted">sec</span>
        </label>
      )}
    </div>
  )
}
