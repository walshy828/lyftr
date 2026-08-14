import { useState, useEffect, useMemo } from 'react'
import { Dumbbell, Pause, Play } from 'lucide-react'
import { exerciseImageSources, exerciseGifSources, type Frame } from '../../utils/exerciseMedia'
import * as types from '../../types'

/** How long each frame holds before crossing to the other, in ms. */
const FRAME_MS = 1100

type MediaExercise = Pick<types.Exercise, 'id' | 'name' | 'image_url' | 'image_url_end' | 'gif_url' | 'source_id'>

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

/** Placeholder shown while no artwork has loaded yet, or none exists. */
function Placeholder({ className }: { className: string }) {
  return (
    <div className={`flex items-center justify-center bg-brand-500/10 border border-brand-500/20 ${className}`}>
      <Dumbbell className="w-1/4 h-1/4 text-brand-500" />
    </div>
  )
}

/**
 * A single animated GIF of the movement, when the library was seeded from
 * the optional Gymvisual-sourced dataset (EXERCISE_GIF_SOURCE). The browser
 * animates it natively — no interval/crossfade bookkeeping needed — so this
 * is a strictly simpler render path than the two-frame fallback below.
 * Reduced-motion users still get the (static) first frame; browsers don't
 * offer a way to freeze a GIF, so this is the same tradeoff every animated
 * image on the web makes.
 */
function GifDemo({ exercise, sources, className }: { exercise: MediaExercise; sources: string[]; className: string }) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { setAttempt(0); setLoaded(false) }, [exercise.id])

  const src = sources[attempt]
  if (!src) return <Placeholder className={className} />

  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      <img
        key={src}
        src={src}
        alt={`${exercise.name} demonstration`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setAttempt(a => a + 1)}
        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-300"
        style={{ opacity: loaded ? 1 : 0 }}
      />
      {!loaded && <Placeholder className="absolute inset-0" />}
    </div>
  )
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
function CrossfadeDemo({ exercise, className, compact }: { exercise: MediaExercise; className: string; compact?: boolean }) {
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

  if (!startSrc && !endSrc) return <Placeholder className={className} />

  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
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
          className="absolute bottom-2 right-2 flex items-center gap-1 pl-2 pr-2.5 py-1 rounded-full bg-black/60 backdrop-blur text-white hover:bg-black/75 transition-colors"
        >
          {paused
            ? <Play className="w-3 h-3 fill-current" />
            : <Pause className="w-3 h-3 fill-current" />}
          <span className="text-[10px] font-semibold">{paused ? 'tap to play' : 'pause'}</span>
        </button>
      )}

      {/* Which position is showing. Without it a paused demo is ambiguous —
          you can't tell the bottom of a squat from the top of one. */}
      {animatable && (
        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-black/60 backdrop-blur text-white">
          {showEnd ? 'End' : 'Start'}
        </span>
      )}
    </div>
  )
}

export default function ExerciseDemo({ exercise, className = '', compact }: Props) {
  const gifSources = useMemo(() => exerciseGifSources(exercise), [exercise])
  if (gifSources.length > 0) {
    return <GifDemo exercise={exercise} sources={gifSources} className={className} />
  }
  return <CrossfadeDemo exercise={exercise} className={className} compact={compact} />
}
