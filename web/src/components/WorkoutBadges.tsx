import { Feather, Gauge, Flame } from 'lucide-react'
import * as types from '../types'
import { computeWorkoutFocus, type WorkoutFocus } from '../utils/exerciseUtils'

export const FEELING_LABEL: Record<number, string> = { 1: 'Light', 2: 'Moderate', 3: 'Intense' }
const FEELING_ICON: Record<number, typeof Feather> = { 1: Feather, 2: Gauge, 3: Flame }
const FEELING_COLOR: Record<number, string> = {
  1: 'text-success-400',
  2: 'text-warning-400',
  3: 'text-error-400',
}

const FOCUS_LABEL: Record<WorkoutFocus, string> = {
  balanced: 'Balanced',
  upper: 'Upper-focused',
  lower: 'Lower-focused',
  core: 'Core-focused',
}

export function FeelingBadge({ feeling }: { feeling?: number }) {
  if (!feeling) return null
  const Icon = FEELING_ICON[feeling]
  return (
    <span className="flex items-center gap-1 text-xs whitespace-nowrap" data-testid="feeling-badge">
      <Icon className={`w-3 h-3 flex-shrink-0 ${FEELING_COLOR[feeling]}`} />
      <span className={FEELING_COLOR[feeling]}>{FEELING_LABEL[feeling]}</span>
    </span>
  )
}

export function FocusBadge({ workout }: { workout: types.Workout | types.Program }) {
  const focus = computeWorkoutFocus(workout)
  if (!focus) return null
  return (
    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-surface-muted text-tx-muted border border-surface-border whitespace-nowrap">
      {FOCUS_LABEL[focus]}
    </span>
  )
}
