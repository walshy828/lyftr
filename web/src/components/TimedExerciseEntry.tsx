import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw, Check, Timer } from 'lucide-react'
import { useWorkoutSession } from '../stores/workoutSession'
import { useExerciseTimer } from '../hooks/useExerciseTimer'
import { fmtClock } from '../utils/workoutSets'
import { IconButton } from './ui'

interface TimedExerciseEntryProps {
  /** Seconds to pre-fill the countdown with, from the exercise's configured default. */
  defaultDurationSec: number
  /** Already-logged duration for this set, if any (e.g. re-opening a completed set). */
  loggedDurationSec: number
  exIdx: number
  setIdx: number
  completed?: boolean
}

// Live countdown for a timed (hold/stretch) set — the Gym Mode equivalent of
// the reps/weight tiles for a strength set, or CardioEntry for cardio. Start
// counts down from an editable duration, ticks visually, and beeps once at
// zero (see useExerciseTimer/utils/beep). The resulting duration is written to
// the set's actual_duration the moment the countdown finishes, or immediately
// if the user stops it early.
export default function TimedExerciseEntry({
  defaultDurationSec, loggedDurationSec, exIdx, setIdx, completed,
}: TimedExerciseEntryProps) {
  const { exTimerExIdx, exTimerSetIdx, startExerciseTimer, pauseExerciseTimer, resumeExerciseTimer, clearExerciseTimer, updateSet } = useWorkoutSession()
  const { active, paused, done, left, durationSec } = useExerciseTimer()
  const isThisTimer = exTimerExIdx === exIdx && exTimerSetIdx === setIdx

  const [durationInput, setDurationInput] = useState(loggedDurationSec || defaultDurationSec || 30)

  // The countdown reaching zero IS the completion event for this set — log it
  // the moment it happens, no separate confirmation step.
  useEffect(() => {
    if (isThisTimer && done) {
      updateSet(exIdx, setIdx, 'actual_duration', durationSec)
    }
  }, [isThisTimer, done, durationSec, exIdx, setIdx, updateSet])

  const start = () => startExerciseTimer(Math.max(1, durationInput), exIdx, setIdx)

  const stopAndLog = () => {
    const elapsed = Math.max(0, durationSec - left)
    updateSet(exIdx, setIdx, 'actual_duration', elapsed)
    clearExerciseTimer()
  }

  const reset = () => {
    clearExerciseTimer()
    setDurationInput(defaultDurationSec || 30)
  }

  const showRunning = isThisTimer && (active || done)

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-all duration-200 ${
        completed ? 'bg-brand-500/10 border-brand-500/20' : 'bg-surface-muted/30 border-surface-border/60'
      }`}
    >
      {showRunning ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center justify-center gap-3">
            {done ? (
              <Check className="w-7 h-7 text-success-500" />
            ) : (
              <IconButton
                icon={paused ? Play : Pause}
                label={paused ? 'Resume timer' : 'Pause timer'}
                onClick={paused ? resumeExerciseTimer : pauseExerciseTimer}
                variant="ghost" size="lg"
                className="!text-brand-500 hover:!text-brand-500"
              />
            )}
            <span className="font-display text-4xl font-black tabular-nums text-tx-primary leading-none">{fmtClock(left)}</span>
          </div>
          {done ? (
            <p className="text-xs text-success-500 font-medium">Logged {fmtClock(durationSec)}</p>
          ) : (
            <div className="flex gap-2 w-full">
              <button
                onClick={stopAndLog}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold bg-brand-500 text-white active:scale-95"
              >
                <Check className="w-4 h-4" />Stop &amp; log
              </button>
              <button
                onClick={reset}
                aria-label="Reset timer"
                className="flex items-center justify-center px-3 py-2.5 rounded-xl bg-surface-muted border border-surface-border text-tx-secondary active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 flex-1">
            <Timer className="w-4 h-4 text-tx-muted flex-shrink-0" />
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={durationInput}
              onChange={e => setDurationInput(Math.max(1, Math.round(Number(e.target.value) || 0)))}
              disabled={completed}
              className="input text-base text-center py-2.5 w-full"
              aria-label="Hold duration in seconds"
            />
            <span className="text-xs text-tx-muted flex-shrink-0">sec</span>
          </label>
          <button
            onClick={start}
            disabled={completed}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-brand-500 text-white active:scale-95 disabled:opacity-40"
          >
            <Play className="w-4 h-4" />Start
          </button>
        </div>
      )}
    </div>
  )
}
