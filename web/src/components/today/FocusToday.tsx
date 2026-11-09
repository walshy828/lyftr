import { CheckCircle2, Circle, Target } from 'lucide-react'
import type { FocusAction, FocusItem } from '../../utils/todayFocus'
import type { Insight } from '../../utils/dashboardMetrics'

interface Props {
  items: FocusItem[]
  weekly: Insight[]
  onAction: (a: FocusAction) => void
}

const ICON = {
  todo: { Icon: Circle, cls: 'text-tx-muted' },
  focus: { Icon: Target, cls: 'text-fuel' },
  good: { Icon: CheckCircle2, cls: 'text-move' },
} as const

/**
 * Today's checklist (actionable, today-scoped) followed by this week's
 * pattern-level reads ("protein on point 5 of 6 days"). One card answers
 * "what do I need to do" and "how am I doing" without scrolling.
 */
export default function FocusToday({ items, weekly, onAction }: Props) {
  if (items.length === 0 && weekly.length === 0) return null
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-3.5 pb-1 flex items-center justify-between">
        <p className="eyebrow">Focus today</p>
        <span className="text-[11px] text-tx-muted tabular-nums">
          {items.filter(i => i.tone === 'good').length}/{items.length} done
        </span>
      </div>
      <ul className="divide-y divide-surface-border">
        {items.map(it => {
          const { Icon, cls } = ICON[it.tone]
          return (
            <li key={it.id} className="flex items-center gap-3 px-4 py-3">
              <Icon className={`w-5 h-5 flex-shrink-0 ${cls}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${it.tone === 'good' ? 'text-tx-secondary' : 'text-tx-primary'}`}>{it.title}</p>
                {it.detail && <p className="text-xs text-tx-muted truncate">{it.detail}</p>}
              </div>
              {it.action && (
                <button onClick={() => onAction(it.action!)} className="btn-sm btn-primary flex-shrink-0">
                  {it.actionLabel}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {weekly.length > 0 && (
        <div className="px-4 py-3 bg-surface-overlay/50 border-t border-surface-border space-y-1.5">
          <p className="eyebrow">This week</p>
          {weekly.map((w, i) => (
            <p key={i} className="flex items-start gap-2 text-xs text-tx-secondary">
              <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${w.tone === 'good' ? 'bg-move' : 'bg-fuel'}`} />
              {w.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
