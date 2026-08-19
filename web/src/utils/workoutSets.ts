// Format whole seconds as m:ss (e.g. 90 → "1:30"). Shared by the rest banner and
// the minimized session-pill chip.
export function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  return `${m}:${String(totalSeconds % 60).padStart(2, '0')}`
}

// True for walk/run/bike-style exercises — the exercise library (free-exercise-db)
// tags these category === 'cardio'. Drives the switch from a reps/weight grid to
// a single time+distance+steps entry throughout logging and display.
export function isCardio(ex?: { category?: string } | null): boolean {
  return ex?.category === 'cardio'
}

// True for hold/stretch-style exercises (e.g. a plank) logged by a live
// countdown instead of reps/weight. Orthogonal to category/isCardio — a timed
// exercise can belong to any muscle group.
export function isTimed(ex?: { is_timed?: boolean } | null): boolean {
  return !!ex?.is_timed
}

// Parse a "m:ss" or "mm:ss" (or bare seconds/minutes) string into whole seconds.
// Lenient: "32:10" → 1930, "5" → 300 (treated as 5:00 when no colon), "" → 0.
export function parseClock(input: string): number {
  const t = input.trim()
  if (!t) return 0
  if (t.includes(':')) {
    const [m, s] = t.split(':')
    return (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0)
  }
  // A bare number with no colon reads as minutes — matches how people say
  // "a 30 minute walk".
  return Math.round((parseFloat(t) || 0) * 60)
}

// Index of the first not-completed set after `afterIdx`, or -1 if none. Shared by
// gym-mode auto-advance (which set to focus after completing one) and the rest
// banner's "set N next" label so the two can never drift out of sync.
export function nextIncompleteSet(sets: { completed?: boolean }[], afterIdx: number): number {
  return sets.findIndex((s, i) => i > afterIdx && !s.completed)
}
