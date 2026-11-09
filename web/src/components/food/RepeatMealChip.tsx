import { Repeat2 } from 'lucide-react'
import FoodAvatar from '../ui/FoodAvatar'
import * as types from '../../types'

interface Props {
  entries: types.FoodLog[]
  label: string
  busy: boolean
  onRepeat: () => void
}

/**
 * Shown in an empty meal when the day before had that meal: one tap logs the
 * same thing again. Most breakfasts are yesterday's breakfast.
 */
export default function RepeatMealChip({ entries, label, busy, onRepeat }: Props) {
  const kcal = entries.reduce((s, e) => s + e.calories, 0)
  return (
    <button
      onClick={onRepeat}
      disabled={busy}
      className="w-full flex items-center gap-3 px-4 py-3 border-t border-surface-border text-left hover:bg-surface-overlay/60 transition-colors disabled:opacity-60"
    >
      <div className="flex -space-x-2 flex-shrink-0">
        {entries.slice(0, 3).map(e => <FoodAvatar key={e.id} food={e} size="xs" className="ring-2 ring-surface-raised" />)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-tx-primary flex items-center gap-1.5">
          <Repeat2 className="w-3.5 h-3.5 text-brand-400" /> {busy ? 'Adding…' : `Same as ${label}`}
        </p>
        <p className="text-xs text-tx-muted truncate">{entries.map(e => e.name).join(' · ')}</p>
      </div>
      <span className="text-xs font-semibold text-tx-secondary tabular-nums flex-shrink-0">{Math.round(kcal)} kcal</span>
    </button>
  )
}
