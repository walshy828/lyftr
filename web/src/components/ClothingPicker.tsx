import { Shirt } from 'lucide-react'
import { lbsToDisplay, round1, weightShort, useSettingsStore } from '../stores/settings'
import * as types from '../types'

interface Props {
  profiles: types.ClothingProfile[]
  value: number | null
  onChange: (id: number) => void
  /** Raw scale reading in the display unit; when set, shows the adjusted result. */
  rawDisplay?: number
}

// Chip row for choosing what you were wearing on the scale. Renders nothing
// until the profiles load (or if there are none) so weigh-in never blocks on it.
export default function ClothingPicker({ profiles, value, onChange, rawDisplay }: Props) {
  const { settings } = useSettingsStore()
  const unit = settings.weight_unit
  if (profiles.length === 0) return null

  const selected = profiles.find(p => p.id === value)
  const offset = selected ? round1(lbsToDisplay(selected.offset_lbs, unit)) : 0

  return (
    <div>
      <label className="label">
        <Shirt className="w-3 h-3" /> Wearing
      </label>
      <div className="flex flex-wrap gap-2 mt-1.5" role="radiogroup" aria-label="Clothing worn on the scale">
        {profiles.map(p => {
          const active = p.id === value
          const off = round1(lbsToDisplay(p.offset_lbs, unit))
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                active
                  ? 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                  : 'bg-surface-overlay border-surface-border text-tx-secondary hover:text-tx-primary'
              }`}
            >
              {p.name}{off > 0 && <span className="text-tx-muted"> · −{off}</span>}
            </button>
          )
        })}
      </div>
      {rawDisplay != null && rawDisplay > 0 && offset > 0 && (
        <p className="text-[11px] text-tx-muted mt-1.5">
          Counts as {round1(rawDisplay - offset)} {weightShort(unit)} after removing clothing
        </p>
      )}
    </div>
  )
}
