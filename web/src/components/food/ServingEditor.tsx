import { useState } from 'react'
import { Pencil } from 'lucide-react'

interface ServingEditorProps {
  servingSize: string
  servingSizeGrams: number
  servingSizeML: number
  onChange: (servingSize: string, servingSizeGrams: number, servingSizeML: number) => void
  /** 'md' is the compact quick-log layout, 'lg' the full review view. */
  size?: 'md' | 'lg'
}

/**
 * Lets the user say what one serving of this food actually is.
 *
 * Without this, a hand-entered food is stuck on the placeholder "1 serving":
 * the unit dropdown has nothing else to offer, because `buildUnitOptions` only
 * adds g/oz once a gram basis exists. Naming the serving ("1/4 cup") makes the
 * logged entry mean something, and supplying its weight unlocks the exact
 * units for free.
 *
 * Weight and volume are optional on purpose. Blank means unknown, which is
 * better than a guessed number — the basis divides into every macro shown after
 * it. Filling both states this food's density, which upgrades its cup and spoon
 * units from estimates to exact conversions.
 */
export default function ServingEditor({ servingSize, servingSizeGrams, servingSizeML, onChange, size = 'lg' }: ServingEditorProps) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-tx-muted hover:text-tx-primary transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
        Edit serving
      </button>
    )
  }

  const inputHeight = size === 'lg' ? '' : 'h-10'

  return (
    <div className="space-y-1.5 pt-1">
      <div>
        <label className="label mb-1.5 block">1 serving is</label>
        <input
          type="text"
          value={servingSize}
          onChange={e => onChange(e.target.value, servingSizeGrams, servingSizeML)}
          placeholder="e.g. 1/4 cup"
          maxLength={100}
          aria-label="Serving size"
          className={`input w-full ${inputHeight}`}
        />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="label mb-1.5 block">Weight (g)</label>
          <input
            type="number"
            value={servingSizeGrams || ''}
            onChange={e => onChange(servingSize, Math.max(0, Number(e.target.value) || 0), servingSizeML)}
            placeholder="—"
            min={0}
            aria-label="Serving weight in grams"
            className={`input w-full tabular-nums ${inputHeight}`}
          />
        </div>
        <div>
          <label className="label mb-1.5 block">Volume (ml)</label>
          <input
            type="number"
            value={servingSizeML || ''}
            onChange={e => onChange(servingSize, servingSizeGrams, Math.max(0, Number(e.target.value) || 0))}
            placeholder="—"
            min={0}
            aria-label="Serving volume in millilitres"
            className={`input w-full tabular-nums ${inputHeight}`}
          />
        </div>
      </div>
      <p className="text-xs text-tx-muted">
        Both optional — either one unlocks the unit picker, and filling both makes cups and spoons exact for this food.
      </p>
    </div>
  )
}
