import { BookOpen, Check, Moon, CalendarDays } from 'lucide-react'
import { Sheet } from './ui'
import * as types from '../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  dayLabel: string
  programs: types.Program[]
  assignedIds: number[]
  saving: boolean
  onToggleProgram: (programId: number) => void
  onSetRest: () => void
}

/**
 * Day-detail sheet for the Plan page's weekly pattern: "Rest day" plus every
 * routine, each toggleable — multiple routines can be assigned to one day,
 * so this stays a multi-select list rather than a single-select picker.
 */
export default function PlanDaySheet({
  isOpen, onClose, dayLabel, programs, assignedIds, saving, onToggleProgram, onSetRest,
}: Props) {
  const isRest = assignedIds.length === 0

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={dayLabel} icon={<CalendarDays className="w-4 h-4 text-brand-500" />}>
      <div className="p-3 space-y-1.5">
        <button
          disabled={saving}
          onClick={onSetRest}
          className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors disabled:opacity-50 ${
            isRest ? 'border-brand-500/50 bg-brand-500/10' : 'border-surface-border bg-surface-muted/40 hover:border-brand-500/30'
          }`}
        >
          <div className="w-9 h-9 rounded-lg bg-surface-overlay border border-surface-border flex items-center justify-center flex-shrink-0">
            <Moon className="w-4 h-4 text-tx-muted" />
          </div>
          <span className="text-sm font-medium text-tx-primary flex-1">Rest day</span>
          {isRest && <Check className="w-4 h-4 text-brand-500 flex-shrink-0" />}
        </button>

        {programs.length === 0 ? (
          <p className="text-xs text-tx-muted px-3 py-2">No routines yet — create one from the Plan page.</p>
        ) : (
          programs.map(p => {
            const on = assignedIds.includes(p.id)
            return (
              <button
                key={p.id}
                disabled={saving}
                onClick={() => onToggleProgram(p.id)}
                aria-pressed={on}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors disabled:opacity-50 ${
                  on ? 'border-brand-500/50 bg-brand-500/10' : 'border-surface-border bg-surface-muted/40 hover:border-brand-500/30'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-4 h-4 text-brand-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-tx-primary truncate">{p.name}</p>
                  <p className="text-xs text-tx-muted">{p.exercises?.length || 0} exercises</p>
                </div>
                {on && <Check className="w-4 h-4 text-brand-500 flex-shrink-0" />}
              </button>
            )
          })
        )}
      </div>
    </Sheet>
  )
}
