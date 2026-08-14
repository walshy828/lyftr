import * as types from '../types'

export type EffortScale = Exclude<types.UserSettings['track_effort'], ''>

/**
 * Both scales persist to the same `set.rpe` field, so a set rated on one scale
 * stays comparable with one rated on the other. RIR is the inverse: 0 reps in
 * reserve is maximal effort (RPE 10), 4 in reserve is RPE 6.
 */
export function effortToStored(scale: EffortScale, value: number): number {
  return scale === 'rir' ? 10 - value : value
}

export function storedToEffort(scale: EffortScale, stored: number): number {
  return scale === 'rir' ? 10 - stored : stored
}

/** RIR above ~5 stops being a meaningful judgement, so the scale stops there. */
const OPTIONS: Record<EffortScale, number[]> = {
  rpe: [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10],
  rir: [5, 4, 3, 2, 1, 0],
}

const LABEL: Record<EffortScale, string> = { rpe: 'RPE', rir: 'RIR' }

// Colour tracks how hard the set was, on the same stored scale for both — so a
// maximal set looks maximal whether it was entered as RPE 10 or RIR 0.
function tone(stored: number): string {
  if (stored >= 9.5) return 'bg-error-500/20 text-error-400 border-error-500/40'
  if (stored >= 8.5) return 'bg-warning-500/20 text-warning-400 border-warning-500/40'
  return 'bg-brand-500/20 text-brand-400 border-brand-500/40'
}

interface Props {
  scale: EffortScale
  /** The stored value (RPE-equivalent), or 0/undefined for "not rated". */
  value?: number
  onChange: (stored: number) => void
  disabled?: boolean
}

/**
 * A per-set effort rating. Rendered only when the user has opted into a scale
 * in Settings — `sets.rpe` has existed since the schema was written but was
 * never collected, and putting an unrequested control on every set is the
 * fastest way to make logging feel like paperwork.
 *
 * Tapping the selected chip again clears the rating: mis-taps happen mid-set,
 * and there is otherwise no way back to "not rated".
 */
export default function EffortPicker({ scale, value, onChange, disabled }: Props) {
  const rated = typeof value === 'number' && value > 0

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-semibold text-tx-muted uppercase tracking-wider shrink-0">
        {LABEL[scale]}
      </span>
      <div className="flex items-center gap-1 flex-wrap">
        {OPTIONS[scale].map(opt => {
          const stored = effortToStored(scale, opt)
          const selected = rated && Math.abs(stored - (value as number)) < 0.01
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`${LABEL[scale]} ${opt}`}
              onClick={() => onChange(selected ? 0 : stored)}
              className={`min-w-[1.75rem] h-7 px-1.5 rounded-md border text-[11px] font-semibold tabular-nums transition-colors disabled:opacity-40 ${
                selected
                  ? tone(stored)
                  : 'bg-surface-muted/40 text-tx-muted border-transparent hover:border-surface-border'
              }`}
            >
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}
