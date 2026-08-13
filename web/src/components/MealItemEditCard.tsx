import { useState } from 'react'
import { Minus, Plus, Trash2, ScanBarcode, Loader2 } from 'lucide-react'
import IconButton from './ui/IconButton'
import SourceBadge from './food/SourceBadge'
import { foodAPI } from '../services/api'
import * as types from '../types'

/**
 * A parsed meal item, plus the review-screen state. `source` starts undefined
 * (meaning "as parsed") and is set when the user swaps in a real database
 * entry, so the logged row records where its numbers actually came from
 * instead of always claiming to be an AI estimate.
 */
export type EditableMealItem = types.MealItem & {
  servings: number
  include: boolean
  source?: types.FoodSearchResult['source']
  label_accurate?: boolean
}

interface Props {
  item: EditableMealItem
  confidence?: 'high' | 'medium' | 'low'
  portionReasoning?: string
  onChange: (patch: Partial<EditableMealItem>) => void
  onRemove: () => void
}

const CONFIDENCE_STYLES: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  low: 'bg-error-500/10 text-error-400 border-error-500/30',
}

/**
 * Searches the food databases for the item's name and offers to replace the
 * AI's estimate with real Nutrition Facts values.
 *
 * Only label-accurate results are offered. A per-100g reference row would need
 * the user to work out how much of it they ate — which is the manual arithmetic
 * this is meant to remove — and swapping one estimate for another isn't worth a
 * round trip.
 */
function LabelLookup({ item, onChange }: { item: EditableMealItem; onChange: Props['onChange'] }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<types.FoodSearchResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      const found = await foodAPI.search(item.name, 10)
      const labelled = found.filter(r => r.label_accurate)
      setResults(labelled)
      if (labelled.length === 0) setError(`No nutrition label found for "${item.name}"`)
    } catch {
      setError('Could not reach the food database')
    } finally {
      setLoading(false)
    }
  }

  const apply = (r: types.FoodSearchResult) => {
    onChange({
      name: r.name,
      calories: Math.round(r.calories),
      protein: +r.protein.toFixed(1),
      carbs: +r.carbs.toFixed(1),
      fat: +r.fat.toFixed(1),
      fiber: +(r.fiber ?? 0).toFixed(1),
      sugar: +(r.sugar ?? 0).toFixed(1),
      sodium: +(r.sodium ?? 0).toFixed(1),
      cholesterol: +(r.cholesterol ?? 0).toFixed(1),
      serving_size: r.serving_size,
      // The label describes one serving, so the multiplier resets — carrying
      // over the AI's portion guess would rescale numbers it never described.
      servings: 1,
      source: r.source,
      label_accurate: true,
    })
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={!item.name.trim()}
        className="flex items-center gap-1.5 text-xs text-tx-muted hover:text-tx-primary disabled:opacity-40 transition-colors"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanBarcode className="w-3.5 h-3.5" />}
        Look up label
      </button>

      {open && !loading && (
        <div className="rounded-xl border border-surface-border overflow-hidden">
          {error && <p className="px-3 py-2.5 text-xs text-tx-muted">{error}</p>}
          {results.map((r, i) => (
            <button
              key={`${r.source}-${r.name}-${r.brand}-${i}`}
              type="button"
              onClick={() => apply(r)}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-surface-muted transition-colors border-b border-surface-border last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-xs font-semibold text-tx-primary truncate">{r.name}</p>
                  <SourceBadge item={r} className="flex-shrink-0" />
                </div>
                <p className="text-[11px] text-tx-muted truncate mt-0.5">
                  {r.brand ? `${r.brand} · ` : ''}{Math.round(r.calories)} kcal · {r.serving_size}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MealItemEditCard({ item, confidence, portionReasoning, onChange, onRemove }: Props) {
  return (
    <div className={`card p-4 space-y-3 ${!item.include ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={item.name}
              onChange={e => onChange({ name: e.target.value })}
              className="font-semibold text-sm text-tx-primary bg-transparent border-0 border-b border-transparent hover:border-surface-border focus:border-brand-500 outline-none w-full px-0 py-0.5"
            />
            {item.label_accurate && (
              <SourceBadge item={{ source: item.source ?? 'fdc', label_accurate: true }} className="flex-shrink-0" />
            )}
            {confidence && !item.label_accurate && (
              <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize ${CONFIDENCE_STYLES[confidence]}`}>
                {confidence}
              </span>
            )}
          </div>
          <input
            type="text"
            value={item.serving_size ?? item.quantity ?? ''}
            onChange={e => onChange({ serving_size: e.target.value })}
            placeholder="Serving size"
            className="text-xs text-tx-muted bg-transparent border-0 border-b border-transparent hover:border-surface-border focus:border-brand-500 outline-none w-full mt-0.5 px-0 py-0.5"
          />
          {portionReasoning && !item.label_accurate && (
            <p className="text-[11px] text-tx-muted italic mt-1">{portionReasoning}</p>
          )}
        </div>
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg hover:bg-surface-muted text-tx-muted hover:text-error-400 transition-colors flex-shrink-0"
          aria-label="Remove item"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { field: 'calories' as const, label: 'Cal', color: 'text-tx-primary' },
          { field: 'protein' as const, label: 'Protein', color: 'text-emerald-400' },
          { field: 'carbs' as const, label: 'Carbs', color: 'text-amber-400' },
          { field: 'fat' as const, label: 'Fat', color: 'text-violet-400' },
        ].map(m => (
          <div key={m.label} className="rounded-xl border border-surface-border bg-surface-muted p-2 text-center">
            <input
              type="number"
              value={item[m.field]}
              onChange={e => onChange({ [m.field]: Number(e.target.value) || 0 })}
              className={`text-sm font-bold tabular-nums bg-transparent border-0 outline-none w-full text-center ${m.color}`}
            />
            <p className="text-[10px] text-tx-muted mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      <LabelLookup item={item} onChange={onChange} />

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-tx-secondary">
          <input
            type="checkbox"
            checked={item.include}
            onChange={e => onChange({ include: e.target.checked })}
            className="w-4 h-4 rounded accent-brand-500"
          />
          Include
        </label>
        <div className="flex items-center gap-2">
          <IconButton icon={Minus} variant="secondary" size="sm" label="Decrease servings" onClick={() => onChange({ servings: Math.max(0.5, +(item.servings - 0.5).toFixed(1)) })} />
          <span className="text-sm font-semibold tabular-nums w-10 text-center">{item.servings}×</span>
          <IconButton icon={Plus} variant="secondary" size="sm" label="Increase servings" onClick={() => onChange({ servings: +(item.servings + 0.5).toFixed(1) })} />
        </div>
      </div>
    </div>
  )
}
