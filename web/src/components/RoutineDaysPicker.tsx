import { useEffect, useState } from 'react'
import { CalendarRange, Check } from 'lucide-react'
import { format } from 'date-fns'
import { scheduleAPI, apiErrorMessage } from '../services/api'
import * as types from '../types'

// Monday-first for display; the API speaks Go's time.Weekday (0 = Sunday).
const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]

/**
 * Which days of the week this routine is on, editable in place. Saves the
 * whole weekly pattern (that's the API's shape), touching only this routine's
 * membership on each day so other routines' assignments are preserved.
 */
export default function RoutineDaysPicker({ programId, highlight = false }: { programId: number; highlight?: boolean }) {
  const [recurring, setRecurring] = useState<types.RecurringSchedule | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd')
    scheduleAPI.range(today, today).then(r => setRecurring(r.recurring ?? {})).catch(() => setRecurring({}))
  }, [])

  const on = (wd: number) => (recurring?.[String(wd)] ?? []).some(p => p.program_id === programId)

  const toggle = async (wd: number) => {
    if (!recurring) return
    const next: Record<string, number[]> = {}
    for (const [k, list] of Object.entries(recurring)) next[k] = list.map(p => p.program_id)
    const cur = next[String(wd)] ?? []
    next[String(wd)] = on(wd) ? cur.filter(id => id !== programId) : [...cur, programId]
    setSaving(true)
    try {
      const res = await scheduleAPI.replace(next)
      setRecurring(res.recurring ?? {})
      setError(null)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update your week'))
    } finally {
      setSaving(false)
    }
  }

  const count = DAYS.filter(([wd]) => on(wd)).length

  return (
    <div className={`card p-4 ${highlight ? 'border-brand-500/50 bg-brand-500/5' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-tx-primary flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-train" />
          {highlight ? 'Put it on your week' : 'On your week'}
        </p>
        <span className="text-xs text-tx-muted">{recurring === null ? '…' : count === 0 ? 'Not scheduled' : `${count}× / week`}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Days of the week">
        {DAYS.map(([wd, label]) => {
          const active = on(wd)
          return (
            <button
              key={wd}
              disabled={saving || recurring === null}
              aria-pressed={active}
              onClick={() => toggle(wd)}
              className={`py-2 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 border transition-colors disabled:opacity-60 ${
                active ? 'bg-train text-[#0a0b0f] border-train' : 'bg-surface-overlay text-tx-secondary border-transparent hover:border-surface-border'
              }`}
            >
              {label}
              {active ? <Check className="w-3 h-3" /> : <span className="w-3 h-3" />}
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs text-error-400 mt-2">{error}</p>}
    </div>
  )
}
