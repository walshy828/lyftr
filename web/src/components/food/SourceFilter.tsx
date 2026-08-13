import { Check } from 'lucide-react'
import * as types from '../../types'

const SOURCES: { value: types.FoodSource; label: string; hint: string }[] = [
  { value: 'fdc', label: 'USDA', hint: 'USDA FoodData Central — manufacturer label panels and whole-food reference data' },
  { value: 'off', label: 'Open Food Facts', hint: 'Open Food Facts — crowdsourced packaged products' },
]

interface Props {
  value: types.FoodSource[]
  onChange: (next: types.FoodSource[]) => void
  className?: string
}

/**
 * Narrows the food search to specific upstream databases.
 *
 * Multi-select rather than a segmented control, because "both" is the useful
 * default and the sources genuinely complement each other — USDA carries real
 * label panels, Open Food Facts carries far more barcoded products.
 *
 * Turning off the last remaining source is a no-op rather than a disabled
 * button: a search that queries nothing returns nothing, which reads as "no
 * results for your food" and sends the user hunting for a problem that isn't
 * there.
 */
export default function SourceFilter({ value, onChange, className = '' }: Props) {
  const toggle = (source: types.FoodSource) => {
    const on = value.includes(source)
    if (on && value.length === 1) return
    onChange(on ? value.filter(s => s !== source) : [...value, source])
  }

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-tx-muted">Sources</span>
      {SOURCES.map(s => {
        const on = value.includes(s.value)
        const last = on && value.length === 1
        return (
          <button
            key={s.value}
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={s.hint}
            title={last ? 'At least one source must stay on' : s.hint}
            onClick={() => toggle(s.value)}
            className={`flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium transition-colors ${
              on
                ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                : 'bg-surface-muted text-tx-muted border-surface-border hover:text-tx-primary'
            } ${last ? 'cursor-default' : ''}`}
          >
            {on && <Check className="w-3 h-3 flex-shrink-0" />}
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
