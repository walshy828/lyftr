import { useRef, useState, useCallback, type ReactNode } from 'react'
import { Dumbbell } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { muscleColorBordered, EQUIPMENT_LABEL } from '../../utils/exerciseUtils'
import { exerciseImageSources, hasExerciseImage } from '../../utils/exerciseMedia'
import * as types from '../../types'

/**
 * A row thumbnail that walks its candidate sources on error. The local cache
 * can't serve exercises whose source_id hasn't been backfilled by a sync, so
 * the upstream URL has to stay available as a fallback.
 */
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
      className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-surface-muted"
    />
  )
}

interface Props {
  exercises: types.Exercise[]
  loading?: boolean
  /** Opens the exercise — the detail sheet in the picker, the route elsewhere. */
  onOpen: (exercise: types.Exercise) => void
  /** Optional trailing control per row, e.g. the picker's "add" button. */
  renderAction?: (exercise: types.Exercise) => ReactNode
  emptyLabel?: string
}

/**
 * The virtualized exercise list, shared by the in-session picker and the browse
 * page. The catalog is ~870 rows, so rendering them all costs a visible stall
 * on a phone; virtualizing keeps scrolling smooth on the hardware this is
 * actually used on.
 *
 * Row height is fixed at 64px to match `estimateSize` — a row that grows past
 * it (a long name wrapping) would drift out of alignment with its measured
 * slot, so the name truncates rather than wraps.
 */
export default function ExerciseList({ exercises, loading, onOpen, renderAction, emptyLabel = 'No exercises found' }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: exercises.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 64, []),
    overscan: 5,
  })

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {loading && exercises.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-tx-muted text-sm">
          <Dumbbell className="w-5 h-5 mr-2 animate-pulse text-brand-500" />
          Loading exercises…
        </div>
      ) : exercises.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-tx-muted text-sm">{emptyLabel}</div>
      ) : (
        <div className="px-4 py-2 relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(row => {
            const ex = exercises[row.index]
            return (
              <div
                key={ex.id}
                style={{ position: 'absolute', top: row.start, left: 0, right: 0, height: row.size, padding: '0 1rem' }}
              >
                <div className="w-full flex items-center gap-2 rounded-xl hover:bg-surface-muted transition-colors">
                  <button
                    type="button"
                    onClick={() => onOpen(ex)}
                    className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 text-left"
                  >
                    {/* Static start frame. A row thumbnail is 40px and dozens
                        are on screen at once — animating them all would be
                        noise, and the movement is what the detail view is for. */}
                    {hasExerciseImage(ex, 'start') ? (
                      <ExerciseThumb exercise={ex} />
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
                  {renderAction?.(ex)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
