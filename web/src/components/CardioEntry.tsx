import { useState, useEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { distanceShort, displayDistance, displayToMeters, paceLabel } from '../stores/settings'
import { fmtClock, parseClock } from '../utils/workoutSets'

interface CardioEntryProps {
  durationSec: number
  distanceMeters: number
  steps: number
  /** Weight-unit preference — distance follows it (lbs → mi, kg → km). */
  unit: string
  onDuration: (sec: number) => void
  onDistance: (meters: number) => void
  onSteps: (steps: number) => void
  /** When provided, renders a Done toggle (active-workout logging). */
  completed?: boolean
  onToggleComplete?: () => void
  isNext?: boolean
  disabled?: boolean
}

// A single cardio effort: time (m:ss) + distance + steps, with a derived pace
// readout. Presentational and unit-agnostic at the boundary — values are held
// in canonical seconds/meters/steps; the distance field converts to/from the
// user's display unit. Shared by ActiveWorkout, GymMode, and the add/edit forms.
export default function CardioEntry({
  durationSec, distanceMeters, steps, unit,
  onDuration, onDistance, onSteps,
  completed, onToggleComplete, isNext, disabled,
}: CardioEntryProps) {
  // Time is a free-text m:ss field so the user can type "32:10" naturally; it's
  // parsed to seconds on blur and re-formatted from the source of truth.
  const [timeText, setTimeText] = useState(durationSec ? fmtClock(durationSec) : '')
  useEffect(() => {
    setTimeText(durationSec ? fmtClock(durationSec) : '')
  }, [durationSec])

  const distText = distanceMeters ? String(displayDistance(distanceMeters, unit)) : ''
  const pace = paceLabel(durationSec, distanceMeters, unit)
  const showToggle = onToggleComplete !== undefined

  const commitTime = () => {
    const sec = parseClock(timeText)
    onDuration(sec)
    setTimeText(sec ? fmtClock(sec) : '')
  }

  return (
    <div
      className={`rounded-xl border p-3 space-y-3 transition-all duration-200 ${
        completed
          ? 'bg-brand-500/10 border-brand-500/20'
          : isNext
            ? 'bg-surface-muted/50 border-brand-500/35 shadow-sm shadow-brand-500/10'
            : 'bg-surface-muted/30 border-surface-border/60'
      }`}
    >
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tx-muted font-medium text-center">Time</span>
          <input
            type="text"
            inputMode="numeric"
            value={timeText}
            onChange={e => setTimeText(e.target.value)}
            onBlur={commitTime}
            placeholder="m:ss"
            className={`input text-base text-center py-3 ${completed ? 'opacity-40' : ''}`}
            disabled={disabled}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-tx-muted font-medium text-center">Distance ({distanceShort(unit)})</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={distText}
            onChange={e => onDistance(displayToMeters(Number(e.target.value) || 0, unit))}
            placeholder="0.00"
            className={`input text-base text-center py-3 ${completed ? 'opacity-40' : ''}`}
            disabled={disabled}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-tx-muted font-medium text-center">Steps</span>
          <input
            type="number"
            inputMode="numeric"
            value={steps || ''}
            onChange={e => onSteps(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            placeholder="—"
            className={`input text-base text-center py-3 ${completed ? 'opacity-40' : ''}`}
            disabled={disabled}
          />
        </label>
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-tx-muted tabular-nums">{pace ? `Pace ${pace}` : ' '}</span>
        {showToggle && (
          <button
            onClick={onToggleComplete}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              completed
                ? 'bg-brand-500 text-white hover:bg-brand-600'
                : 'bg-brand-500/15 text-brand-400 hover:bg-brand-500/25'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {completed ? 'Logged' : 'Log'}
          </button>
        )}
      </div>
    </div>
  )
}
