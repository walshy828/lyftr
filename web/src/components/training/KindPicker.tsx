import { KINDS, KIND_META } from '../../utils/trainingKinds'
import type { TrainingKind } from '../../types'

interface Props {
  value: TrainingKind
  onChange: (k: TrainingKind) => void
  /** What the exercises suggest. Marked "auto" while value still equals it
   *  and the user hasn't chosen. */
  suggested?: TrainingKind
  auto?: boolean
}

/** Four chips — Strength / Cardio / Mobility / Mixed — for a routine's type. */
export default function KindPicker({ value, onChange, suggested, auto }: Props) {
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Routine type">
        {KINDS.map(k => {
          const m = KIND_META[k]
          const on = value === k
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(k)}
              className={`flex flex-col items-center gap-1 rounded-xl py-2 px-1 border text-xs font-semibold transition-colors ${
                on ? `${m.tint} border-current` : 'border-surface-border text-tx-muted hover:bg-surface-overlay'
              }`}
            >
              <m.icon className="w-4 h-4" />
              {m.label}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-tx-muted mt-1.5">
        {auto && suggested
          ? <>Picked from the exercises — tap to change. {KIND_META[value].blurb}.</>
          : KIND_META[value].blurb + '.'}
      </p>
    </div>
  )
}

/** Small inline badge for lists and cards. */
export function KindBadge({ kind, className = '' }: { kind?: TrainingKind; className?: string }) {
  if (!kind) return null
  const m = KIND_META[kind]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.tint} ${className}`}>
      <m.icon className="w-3 h-3" />
      {m.label}
    </span>
  )
}
