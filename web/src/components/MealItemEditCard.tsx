import { Minus, Plus, Trash2 } from 'lucide-react'
import IconButton from './ui/IconButton'
import * as types from '../types'

export type EditableMealItem = types.MealItem & { servings: number; include: boolean }

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
            {confidence && (
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
          {portionReasoning && (
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
