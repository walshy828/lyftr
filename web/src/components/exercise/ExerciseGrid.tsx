import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react'
import { Dumbbell } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { muscleColorBordered, EQUIPMENT_LABEL } from '../../utils/exerciseUtils'
import { exerciseImageSources, hasExerciseImage } from '../../utils/exerciseMedia'
import * as types from '../../types'

// Tailwind's `sm` breakpoint — matched in JS because the virtualizer needs to
// know the column count to size each row's slice of exercises, and a CSS
// media query can't tell it that.
const TWO_COL_QUERY = '(min-width: 640px)'

function useColumnCount(): 1 | 2 {
  const [cols, setCols] = useState<1 | 2>(() => (typeof window !== 'undefined' && window.matchMedia(TWO_COL_QUERY).matches ? 2 : 1))
  useEffect(() => {
    const mql = window.matchMedia(TWO_COL_QUERY)
    const onChange = () => setCols(mql.matches ? 2 : 1)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return cols
}

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
    <div className="h-full w-full flex items-center gap-2 rounded-xl border border-surface-border bg-surface-elevated hover:bg-surface-muted transition-colors">
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
          <p className="text-sm font-medium text-tx-primary truncate">{exercise.name}</p>
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
  /** Rendered as the first tile, spanning both columns of the first row. */
  leadingCard?: ReactNode
}

/**
 * The exercise browse page's card grid — two columns on screens wide enough
 * for it, one on mobile. Virtualized by ROW (a pair of exercises), not by
 * individual card: the catalog is ~1300 rows, so rendering everything at once
 * costs a visible stall on a phone, same reasoning as the picker's
 * ExerciseList. react-virtual has no native grid mode, so pairing indices
 * into rows before handing them to useVirtualizer gets the same effect.
 */
export default function ExerciseGrid({ exercises, loading, onOpen, renderAction, emptyLabel = 'No exercises found', leadingCard }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cols = useColumnCount()
  const rowCount = Math.ceil(exercises.length / cols)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 76, []),
    overscan: 6,
  })

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {leadingCard && <div className="p-3 pb-0">{leadingCard}</div>}
      {loading && exercises.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-tx-muted text-sm">
          <Dumbbell className="w-5 h-5 mr-2 animate-pulse text-brand-500" />
          Loading exercises…
        </div>
      ) : exercises.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-tx-muted text-sm">{emptyLabel}</div>
      ) : (
        <div className="p-3 relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(row => {
            const rowItems = exercises.slice(row.index * cols, row.index * cols + cols)
            return (
              <div
                key={row.key}
                className="grid gap-2"
                style={{
                  position: 'absolute', top: row.start, left: 0, right: 0, height: row.size, padding: '0.25rem 0',
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                }}
              >
                {rowItems.map(ex => (
                  <ExerciseCard key={ex.id} exercise={ex} onOpen={onOpen} renderAction={renderAction} />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
