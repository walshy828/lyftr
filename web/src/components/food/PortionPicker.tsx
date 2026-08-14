import { Minus, Plus } from 'lucide-react'
import IconButton from '../ui/IconButton'
import { amountToGrams, findUnit, formatUnitHint, type UnitOption } from '../../utils/portions'

interface PortionPickerProps {
  options: UnitOption[]
  amount: number
  unitId: string
  onChange: (amount: number, unitId: string) => void
  /** 'md' is the compact quick-log layout, 'lg' the full review view. */
  size?: 'md' | 'lg'
}

/**
 * Amount + unit control for a food.
 *
 * Replaces a bare servings stepper so a portion like "1 tbsp" is expressible
 * directly instead of as 0.14 of a 100 g serving. When the food has no gram
 * basis, `options` collapses to the serving alone and this degrades to exactly
 * the old stepper behaviour.
 */
export default function PortionPicker({ options, amount, unitId, onChange, size = 'lg' }: PortionPickerProps) {
  const unit = findUnit(options, unitId)
  const hint = formatUnitHint(unit)
  const totalGrams = amountToGrams(amount, unit)

  // Grams and millilitres tick in useful increments; cups get quarters, since
  // a quarter cup is a measuring cup people own and half a step of 0.5 isn't
  // reachable from the stepper at all. Everything else moves in halves.
  const step = unit.id === 'g' || unit.id === 'ml' ? 5 : unit.id === 'cup' ? 0.25 : 0.5
  const min = unit.id === 'g' || unit.id === 'ml' ? 1 : unit.id === 'cup' ? 0.25 : 0.5

  const bump = (delta: number) => {
    const next = Math.max(min, +(amount + delta).toFixed(2))
    onChange(next, unitId)
  }

  const inputHeight = size === 'lg' ? 'h-12 text-lg' : 'h-10'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <IconButton
          icon={Minus}
          variant="secondary"
          size={size}
          label="Decrease amount"
          onClick={() => bump(-step)}
        />
        <input
          type="number"
          value={amount}
          onChange={e => onChange(Math.max(0, Number(e.target.value) || 0), unitId)}
          step={step}
          min={0}
          aria-label="Amount"
          className={`input text-center w-20 flex-shrink-0 font-semibold tabular-nums ${inputHeight}`}
        />
        <IconButton
          icon={Plus}
          variant="secondary"
          size={size}
          label="Increase amount"
          onClick={() => bump(step)}
        />
        <select
          value={unit.id}
          onChange={e => onChange(amount, e.target.value)}
          aria-label="Unit"
          className={`input flex-1 min-w-0 font-medium ${inputHeight}`}
        >
          {/* The serving option's label already describes it ("1 tbsp", "per
              100g"), so it needs no prefix — and a prefix truncates at phone
              widths, hiding the part that carries the meaning. */}
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      {(hint || totalGrams > 0) && (
        // An estimated conversion is tinted, not just worded: it's the one cue
        // that the gram figure — and so every macro above it — is our
        // arithmetic on an assumed 1 g/ml rather than the product's own label.
        <p className={`text-xs tabular-nums ${unit.estimated ? 'text-amber-400/90' : 'text-tx-muted'}`}>
          {hint}
          {hint && totalGrams > 0 && <span className="mx-1.5">·</span>}
          {totalGrams > 0 && <span>{unit.gramsEstimated ? '≈' : ''}{Math.round(totalGrams)} g total</span>}
        </p>
      )}
    </div>
  )
}
