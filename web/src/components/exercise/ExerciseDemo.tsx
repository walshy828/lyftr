import { useState, useEffect, useRef } from 'react'
import { Dumbbell, Pause, Play } from 'lucide-react'
import * as types from '../../types'

/** How long each frame holds before crossing to the other, in ms. */
const FRAME_MS = 1100

interface Props {
  exercise: Pick<types.Exercise, 'id' | 'name' | 'image_url' | 'image_url_end'>
  className?: string
  /** Suppresses the play/pause control for small thumbnails. */
  compact?: boolean
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Animates an exercise by crossfading its start and end positions.
 *
 * The upstream dataset ships two frames per movement — the bottom and top of
 * the lift — and the seed used to keep only the first, which left every
 * exercise represented by a still photo of someone mid-rep. Alternating the
 * pair shows the actual movement: what travels, and how far.
 *
 * Frames are served from the backend's local cache rather than by upstream URL,
 * so they work offline once seen.
 *
 * The animation is two stacked images with a CSS opacity transition driven by
 * one interval — no per-frame JS, so it costs nothing while scrolling a list of
 * them.
 */
export default function ExerciseDemo({ exercise, className = '', compact }: Props) {
  const [showEnd, setShowEnd] = useState(false)
  const [paused, setPaused] = useState(prefersReducedMotion)
  const [failed, setFailed] = useState<Record<number, boolean>>({})
  const startedRef = useRef(false)

  // Only exercises with two usable frames animate. Some upstream entries ship
  // one image, and a "cross-fade" between a frame and itself is just a photo
  // that occasionally dims.
  const hasEnd = !!exercise.image_url_end && !failed[1]
  const animatable = hasEnd && !failed[0]

  useEffect(() => {
    if (!animatable || paused) return
    const id = setInterval(() => setShowEnd(v => !v), FRAME_MS)
    startedRef.current = true
    return () => clearInterval(id)
  }, [animatable, paused])

  // Both frames missing — nothing to show but the placeholder.
  if (failed[0] && !hasEnd) {
    return (
      <div className={`flex items-center justify-center bg-brand-500/10 border border-brand-500/20 ${className}`}>
        <Dumbbell className="w-1/4 h-1/4 text-brand-500" />
      </div>
    )
  }

  const src = (frame: 'start' | 'end') => `/api/v1/exercises/${exercise.id}/image/${frame}`

  return (
    <div className={`relative overflow-hidden bg-surface-muted ${className}`}>
      <img
        src={src('start')}
        alt={`${exercise.name}, starting position`}
        loading="lazy"
        onError={() => setFailed(f => ({ ...f, 0: true }))}
        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-500"
        style={{ opacity: animatable && showEnd ? 0 : 1 }}
      />
      {hasEnd && (
        <img
          src={src('end')}
          alt={`${exercise.name}, end position`}
          loading="lazy"
          onError={() => setFailed(f => ({ ...f, 1: true }))}
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-500"
          style={{ opacity: animatable && showEnd ? 1 : 0 }}
        />
      )}

      {animatable && !compact && (
        <button
          type="button"
          onClick={() => setPaused(p => !p)}
          aria-label={paused ? 'Play demonstration' : 'Pause demonstration'}
          className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-surface-base/70 backdrop-blur border border-surface-border hover:bg-surface-base transition-colors"
        >
          {paused
            ? <Play className="w-3.5 h-3.5 text-tx-secondary" />
            : <Pause className="w-3.5 h-3.5 text-tx-secondary" />}
        </button>
      )}

      {/* Which position is showing. Without it a paused demo is ambiguous —
          you can't tell the bottom of a squat from the top of one. */}
      {animatable && (
        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-surface-base/70 backdrop-blur text-tx-muted border border-surface-border">
          {showEnd ? 'End' : 'Start'}
        </span>
      )}
    </div>
  )
}
