import { lazy, Suspense, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Search, Plus } from 'lucide-react'
import { exerciseAPI } from '../services/api'
import ExerciseList from './exercise/ExerciseList'
import { muscleColorBordered, formatExerciseName } from '../utils/exerciseUtils'
import * as types from '../types'

// Lazy: the detail view drags in recharts (history chart), and the picker is
// reachable from the always-mounted gym overlay — loading it eagerly would
// put the whole charting library back into the initial bundle.
const ExerciseDetailContent = lazy(() => import('./ExerciseDetailContent'))

interface Props {
  selectedIds: number[]
  onSelect: (exercise: types.Exercise) => void
  onClose: () => void
}

export default function ExercisePicker({ selectedIds, onSelect, onClose }: Props) {
  const [exercises, setExercises] = useState<types.Exercise[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [detailExercise, setDetailExercise] = useState<types.Exercise | null>(null)

  useEffect(() => { load('') }, [])

  useEffect(() => {
    const t = setTimeout(() => load(query), 250)
    return () => clearTimeout(t)
  }, [query])

  const load = async (q: string) => {
    setLoading(true)
    try {
      const data = await exerciseAPI.list(q ? { q } : undefined)
      setExercises(data || [])
    } catch {}
    finally { setLoading(false) }
  }

  const available = exercises.filter(e => !selectedIds.includes(e.id))

  if (detailExercise) {
    return createPortal(
      <div className="fixed inset-0 z-[60] bg-surface-base flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-surface-border flex-shrink-0 bg-surface-base/95 backdrop-blur">
          <button
            onClick={() => setDetailExercise(null)}
            className="p-2 hover:bg-surface-muted rounded-lg transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-tx-muted" />
          </button>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-xl text-tx-primary truncate">{formatExerciseName(detailExercise.name)}</h2>
            <span className={`inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-xs font-medium border ${muscleColorBordered(detailExercise.muscle_group)}`}>
              {detailExercise.muscle_group}
            </span>
          </div>
        </div>

        {/* Detail content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <Suspense fallback={null}>
            <ExerciseDetailContent exercise={detailExercise} />
          </Suspense>
        </div>

        {/* Sticky add bar */}
        <div className="px-4 py-3 border-t border-surface-border flex-shrink-0 bg-surface-base/95 backdrop-blur">
          <button
            type="button"
            onClick={() => onSelect(detailExercise)}
            className="btn-primary btn-lg w-full flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Exercise
          </button>
        </div>
      </div>,
      document.body
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-surface-base flex flex-col animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-surface-border flex-shrink-0 bg-surface-base/95 backdrop-blur">
        <button
          onClick={onClose}
          className="p-2 hover:bg-surface-muted rounded-lg transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5 text-tx-muted" />
        </button>
        <div>
          <h2 className="font-display font-bold text-xl text-tx-primary">Add Exercise</h2>
          <p className="text-xs text-tx-muted">{available.length} available</p>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-surface-border flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tx-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, muscle, equipment…"
            className="input pl-10 w-full"
            autoFocus
          />
        </div>
      </div>

      {/* List */}
      <ExerciseList
        exercises={available}
        loading={loading}
        onOpen={setDetailExercise}
        renderAction={ex => (
          <button
            type="button"
            onClick={() => onSelect(ex)}
            aria-label={`Add ${formatExerciseName(ex.name)}`}
            className="flex-shrink-0 p-2 mr-2 rounded-lg bg-brand-500/10 border border-brand-500/20 hover:bg-brand-500/20 transition-colors"
          >
            <Plus className="w-4 h-4 text-brand-500" />
          </button>
        )}
      />
    </div>,
    document.body
  )
}
