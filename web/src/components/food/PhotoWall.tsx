import FoodAvatar from '../ui/FoodAvatar'
import * as types from '../../types'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const
const LABEL: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' }

/**
 * The day as a picture wall — answers "what did I eat Tuesday?" at a glance,
 * the way a camera roll does, with calories under each tile.
 */
export default function PhotoWall({ logs, onOpen }: { logs: types.FoodLog[]; onOpen: (e: types.FoodLog) => void }) {
  if (logs.length === 0) {
    return <p className="card p-6 text-center text-sm text-tx-muted">Nothing logged on this day.</p>
  }
  return (
    <div className="space-y-4">
      {MEALS.map(m => {
        const entries = logs.filter(l => l.meal === m)
        if (!entries.length) return null
        return (
          <section key={m}>
            <p className="eyebrow mb-2 px-1">
              {LABEL[m]} <span className="normal-case tracking-normal font-normal">· {Math.round(entries.reduce((s, e) => s + e.calories, 0))} kcal</span>
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {entries.map(e => (
                <button key={e.id} onClick={() => onOpen(e)} className="text-left group">
                  <div className="aspect-square w-full rounded-2xl overflow-hidden [&>*]:!w-full [&>*]:!h-full [&>*]:!rounded-2xl [&>div]:!text-5xl">
                    <FoodAvatar food={e} size="lg" />
                  </div>
                  <p className="mt-1.5 text-xs font-medium text-tx-primary truncate">{e.name}</p>
                  <p className="text-[11px] text-tx-muted tabular-nums">{Math.round(e.calories)} kcal · {Math.round(e.protein)}g P</p>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
