import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Search, Dumbbell, Plus } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { exerciseAPI } from '../services/api'
import * as types from '../types'

// Lazy: the detail view drags in recharts (history chart), and the picker is
// reachable from the always-mounted gym overlay — loading it eagerly would
// put the whole charting library back into the initial bundle.
const ExerciseDetailContent = lazy(() => import('./ExerciseDetailContent'))
import { muscleColorBordered, EQUIPMENT_LABEL } from '../utils/exerciseUtils'

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
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const virtualizer = useVirtualizer({
    count: available.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 64, []),
    overscan: 5,
  })

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
            <h2 className="font-display font-bold text-xl text-tx-primary truncate">{detailExercise.name}</h2>
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading && exercises.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-tx-muted text-sm">
            <Dumbbell className="w-5 h-5 mr-2 animate-pulse text-brand-500" />
            Loading exercises…
          </div>
        ) : available.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-tx-muted text-sm">
            No exercises found
          </div>
        ) : (
          <div
            className="px-4 py-2 relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map(row => {
              const ex = available[row.index]
              return (
                <div
                  key={ex.id}
                  style={{
                    position: 'absolute',
                    top: row.start,
                    left: 0,
                    right: 0,
                    height: row.size,
                    padding: '0 1rem',
                  }}
                >
                  <div className="w-full flex items-center gap-2 rounded-xl hover:bg-surface-muted transition-colors">
                    <button
                      type="button"
                      onClick={() => setDetailExercise(ex)}
                      className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 text-left"
                    >
                      {ex.image_url ? (
                        <img
                          src={ex.image_url}
                          alt=""
                          loading="lazy"
                          className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-surface-muted"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                          <Dumbbell className="w-4 h-4 text-brand-500" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-tx-primary truncate">{ex.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${muscleColorBordered(ex.muscle_group)}`}>
                            {ex.muscle_group}
                          </span>
                          {ex.equipment && ex.equipment !== 'other' && (
                            <span className="text-xs text-tx-muted">
                              {EQUIPMENT_LABEL[ex.equipment] || ex.equipment}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelect(ex)}
                      aria-label={`Add ${ex.name}`}
                      className="flex-shrink-0 p-2 mr-2 rounded-lg bg-brand-500/10 border border-brand-500/20 hover:bg-brand-500/20 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-brand-500" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
