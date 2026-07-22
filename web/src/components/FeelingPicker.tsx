import { Feather, Gauge, Flame } from 'lucide-react'

const OPTIONS: { value: 1 | 2 | 3; label: string; icon: typeof Feather }[] = [
  { value: 1, label: 'Light', icon: Feather },
  { value: 2, label: 'Moderate', icon: Gauge },
  { value: 3, label: 'Intense', icon: Flame },
]

// Post-workout "how did that feel" picker. 0 = unrated/skipped, and unselecting
// is always allowed — this is optional context, not a blocker to finishing.
export default function FeelingPicker({ value, onChange }: { value: 0 | 1 | 2 | 3; onChange: (v: 0 | 1 | 2 | 3) => void }) {
  return (
    <div className="mb-5">
      <p className="text-xs text-tx-muted mb-2">How did that feel?</p>
      <div className="flex gap-2">
        {OPTIONS.map(({ value: v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(value === v ? 0 : v)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
              value === v
                ? 'bg-brand-500/15 border-brand-500/40 text-brand-400'
                : 'bg-surface-muted/60 border-surface-border text-tx-muted hover:text-tx-secondary'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
