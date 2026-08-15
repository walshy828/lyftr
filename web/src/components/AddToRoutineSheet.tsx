import { useState, useEffect } from 'react'
import { BookOpen, Check, Plus, Loader2 } from 'lucide-react'
import { Sheet } from './ui'
import { programAPI } from '../services/api'
import { useSettingsStore } from '../stores/settings'
import * as types from '../types'
import { formatExerciseName } from '../utils/exerciseUtils'

interface Props {
  exercise: types.Exercise
  onClose: () => void
}

/**
 * "+Plan" quick-add: append `exercise` to an existing routine with default
 * sets, editable later in the routine's own editor. There's no dedicated
 * add-single-exercise endpoint, so this re-sends the whole exercise list via
 * the same PUT the program editor uses (see ProgramEditor's `addExercise`).
 */
export default function AddToRoutineSheet({ exercise, onClose }: Props) {
  const { settings } = useSettingsStore()
  const [programs, setPrograms] = useState<types.Program[]>([])
  const [loading, setLoading] = useState(true)
  const [addingId, setAddingId] = useState<number | null>(null)
  const [addedName, setAddedName] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    programAPI.list({ limit: 100 })
      .then(setPrograms)
      .catch(() => setError('Failed to load routines'))
      .finally(() => setLoading(false))
  }, [])

  const handleAdd = async (program: types.Program) => {
    setAddingId(program.id)
    setError('')
    try {
      const full = await programAPI.get(program.id)
      const payload = {
        name: full.name,
        notes: full.notes || '',
        exercises: [
          ...full.exercises.map(ex => ({
            exercise_id: ex.exercise_id,
            notes: ex.notes || '',
            rest_seconds: ex.rest_seconds ?? 90,
            sets: ex.sets.map(s => ({ set_number: s.set_number, target_reps: s.target_reps, target_weight: s.target_weight })),
          })),
          {
            exercise_id: exercise.id,
            notes: '',
            rest_seconds: settings.rest_seconds_default ?? 90,
            sets: [{ set_number: 1, target_reps: 0, target_weight: 0 }],
          },
        ],
      }
      await programAPI.update(program.id, payload)
      setAddedName(program.name)
      setTimeout(onClose, 900)
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not add exercise')
      setAddingId(null)
    }
  }

  return (
    <Sheet isOpen onClose={onClose} title="Add to Routine" icon={<Plus className="w-4 h-4 text-brand-500" />}>
      <div className="p-3 space-y-1.5 min-h-[6rem]">
        {error && <div className="alert-error text-sm mb-2">{error}</div>}
        {addedName ? (
          <div className="flex items-center gap-2 p-3 text-sm text-brand-400">
            <Check className="w-4 h-4 flex-shrink-0" /> Added {formatExerciseName(exercise.name)} to {addedName}
          </div>
        ) : loading ? (
          <p className="text-xs text-tx-muted px-1 py-2">Loading routines…</p>
        ) : programs.length === 0 ? (
          <p className="text-xs text-tx-muted px-1 py-2">No routines yet — create one first.</p>
        ) : (
          programs.map(p => (
            <button
              key={p.id}
              disabled={addingId !== null}
              onClick={() => handleAdd(p)}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-surface-border bg-surface-muted/40 hover:border-brand-500/30 transition-colors text-left disabled:opacity-50"
            >
              <div className="w-9 h-9 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-4 h-4 text-brand-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-tx-primary truncate">{p.name}</p>
                <p className="text-xs text-tx-muted">{p.exercises?.length || 0} exercises</p>
              </div>
              {addingId === p.id ? <Loader2 className="w-4 h-4 animate-spin text-brand-500 flex-shrink-0" /> : <Plus className="w-4 h-4 text-tx-muted flex-shrink-0" />}
            </button>
          ))
        )}
      </div>
    </Sheet>
  )
}
