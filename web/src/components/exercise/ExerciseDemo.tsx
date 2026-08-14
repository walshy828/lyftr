import { useState, useEffect, useMemo } from 'react'
import { Dumbbell, Pause, Play } from 'lucide-react'
import { exerciseImageSources, type Frame } from '../../utils/exerciseMedia'
import * as types from '../../types'

/** How long each frame holds before crossing to the other, in ms. */
const FRAME_MS = 1100

type MediaExercise = Pick<types.Exercise, 'id' | 'name' | 'image_url' | 'image_url_end' | 'source_id'>

interface Props {
  exercise: MediaExercise
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
 * Each frame has a list of candidate sources (local cache first, upstream URL
 * as a fallback) and walks it on error, so a library that hasn't been synced
 * yet still renders — see exerciseImageSources.
 */
export default function ExerciseDemo({ exercise, className = '', compact }: Props) {
  const [showEnd, setShowEnd] = useState(false)
  const [paused, setPaused] = useState(prefersReducedMotion)
  // Index into each frame's candidate source list; past the end means the frame
  // has no working source.
  const [attempt, setAttempt] = useState<Record<Frame, number>>({ start: 0, end: 0 })

  const sources = useMemo(() => ({
    start: exerciseImageSources(exercise, 'start'),
    end: exerciseImageSources(exercise, 'end'),
  }), [exercise])

  // Reset when the exercise changes, or a previous failure would suppress the
  // new one's images.
  useEffect(() => { setAttempt({ start: 0, end: 0 }); setShowEnd(false) }, [exercise.id])

  const srcFor = (frame: Frame): string | null => sources[frame][attempt[frame]] ?? null
  const startSrc = srcFor('start')
  const endSrc = srcFor('end')

  // Only a genuine pair animates. Some entries ship one frame, and crossfading
  // a frame with itself is just a photo that occasionally dims.
  const animatable = !!startSrc && !!endSrc

  useEffect(() => {
    if (!animatable || paused) return
    const id = setInterval(() => setShowEnd(v => !v), FRAME_MS)
    return () => clearInterval(id)
  }, [animatable, paused])

  const onFrameError = (frame: Frame) =>
    setAttempt(a => ({ ...a, [frame]: a[frame] + 1 }))

  if (!startSrc && !endSrc) {
    return (
      <div className={`flex items-center justify-center bg-brand-500/10 border border-brand-500/20 ${className}`}>
        <Dumbbell className="w-1/4 h-1/4 text-brand-500" />
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden bg-surface-muted ${className}`}>
      {startSrc && (
        <img
          // Keyed by src so React remounts on fallback rather than reusing the
          // element that already errored.
          key={startSrc}
          src={startSrc}
          alt={`${exercise.name}, starting position`}
          loading="lazy"
          onError={() => onFrameError('start')}
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-500"
          style={{ opacity: animatable && showEnd ? 0 : 1 }}
        />
      )}
      {endSrc && (
        <img
          key={endSrc}
          src={endSrc}
          alt={`${exercise.name}, end position`}
          loading="lazy"
          onError={() => onFrameError('end')}
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-500"
          style={{ opacity: animatable ? (showEnd ? 1 : 0) : startSrc ? 0 : 1 }}
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
