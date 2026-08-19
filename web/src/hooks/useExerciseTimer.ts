import { useWorkoutSession } from '../stores/workoutSession'
import { useCountdown } from './useCountdown'
import { playTimerCompleteBeep } from '../utils/beep'

// Derived exercise-timer state (seconds left, paused/done flags) for the
// current timed (hold/stretch) set's countdown, mirroring useRestTimer.
// Unlike rest, this doesn't auto-clear on completion — the countdown reaching
// zero is itself the "done" state the UI shows (checkmark), and the beep is
// this hook's job via useCountdown's onComplete (fired exactly once).
export function useExerciseTimer() {
  const { exTimerEndsAt, exTimerPausedRemainingMs, exTimerDurationSec } = useWorkoutSession()
  const paused = exTimerPausedRemainingMs != null
  const live = useCountdown(exTimerEndsAt, playTimerCompleteBeep)
  // While paused, exTimerEndsAt is null (live === null) — show the parked remaining time.
  const secondsLeft = paused ? Math.max(0, Math.ceil(exTimerPausedRemainingMs! / 1000)) : live
  const done = !paused && live === 0
  const active = !(exTimerEndsAt == null && !paused) && secondsLeft != null

  return { active, paused, done, left: secondsLeft ?? 0, durationSec: exTimerDurationSec ?? 0 }
}
