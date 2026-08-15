import { useRef, useState, useEffect, type ReactNode } from 'react'
import { Dumbbell } from 'lucide-react'
import { muscleColorBordered, EQUIPMENT_LABEL, formatExerciseName } from '../../utils/exerciseUtils'
import { exerciseImageSources, hasExerciseImage } from '../../utils/exerciseMedia'
import * as types from '../../types'

const PAGE_SIZE = 20

/** A card thumbnail that walks its candidate sources on error — same fallback
 *  chain as the list view's ExerciseThumb, just larger. */
function ExerciseThumb({ exercise }: { exercise: types.Exercise }) {
  const sources = exerciseImageSources(exercise, 'start')
  const [attempt, setAttempt] = useState(0)
  const src = sources[attempt]
  if (!src) return null
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setAttempt(a => a + 1)}
      className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-white"
    />
  )
}

function ExerciseCard({ exercise, onOpen, renderAction }: {
  exercise: types.Exercise
  onOpen: (exercise: types.Exercise) => void
  renderAction?: (exercise: types.Exercise) => ReactNode
}) {
  return (
    <div className="w-full flex items-center gap-2 rounded-xl border border-surface-border bg-surface-elevated hover:bg-surface-muted transition-colors">
      <button
        type="button"
        onClick={() => onOpen(exercise)}
        className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 text-left"
      >
        {hasExerciseImage(exercise, 'start') ? (
          <ExerciseThumb exercise={exercise} />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
            <Dumbbell className="w-5 h-5 text-brand-500" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-tx-primary truncate">{formatExerciseName(exercise.name)}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${muscleColorBordered(exercise.muscle_group)}`}>
              {exercise.muscle_group}
            </span>
            {exercise.equipment && exercise.equipment !== 'other' && (
              <span className="text-xs text-tx-muted">
                {EQUIPMENT_LABEL[exercise.equipment] || exercise.equipment}
              </span>
            )}
          </div>
        </div>
      </button>
      {renderAction && <div className="pr-3 flex-shrink-0">{renderAction(exercise)}</div>}
    </div>
  )
}

interface Props {
  exercises: types.Exercise[]
  loading?: boolean
  onOpen: (exercise: types.Exercise) => void
  renderAction?: (exercise: types.Exercise) => ReactNode
  emptyLabel?: string
  /** Rendered as its own full-width tile above the grid. */
  leadingCard?: ReactNode
}

/**
 * The exercise browse page's card grid. Flows with the page (the page itself
 * scrolls — there's no bounded inner scroll container) and reveals results
 * 20 at a time: only the first page renders up front, and a sentinel below
 * the grid pulls in the next page once it scrolls near the viewport. That
 * keeps the DOM small (~1300 rows would all mount at once otherwise)
 * without the complexity of virtualizing a fixed-height widget.
 *
 * `visibleCount` resets to PAGE_SIZE whenever `exercises` is a new array
 * (the parent re-filters on every search/tab change) — a fresh filter
 * should restart the feed from the top, not keep whatever page depth the
 * previous filter had scrolled to.
 */
export default function ExerciseGrid({ exercises, loading, onOpen, renderAction, emptyLabel = 'No exercises found', leadingCard }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [exercises])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisibleCount(c => Math.min(c + PAGE_SIZE, exercises.length))
    }, { rootMargin: '600px 0px' }) // load well before the sentinel is actually on screen
    io.observe(el)
    return () => io.disconnect()
  }, [exercises])

  const visible = exercises.slice(0, visibleCount)
  const hasMore = visibleCount < exercises.length

  return (
    <div>
      {leadingCard && <div className="mb-2">{leadingCard}</div>}
      {loading && exercises.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-tx-muted text-sm">
          <Dumbbell className="w-5 h-5 mr-2 animate-pulse text-brand-500" />
          Loading exercises…
        </div>
      ) : exercises.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-tx-muted text-sm">{emptyLabel}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visible.map(ex => (
              <ExerciseCard key={ex.id} exercise={ex} onOpen={onOpen} renderAction={renderAction} />
            ))}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="flex items-center justify-center py-6 text-tx-muted text-xs">
              <Dumbbell className="w-3.5 h-3.5 mr-2 animate-pulse text-brand-500" /> Loading more…
            </div>
          )}
        </>
      )}
    </div>
  )
}
