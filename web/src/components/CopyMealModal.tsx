import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, subDays } from 'date-fns'
import { X, AlertCircle, Copy, Check, Square, CheckSquare } from 'lucide-react'
import { foodAPI } from '../services/api'
import { dayToLocalDate } from '../utils/dateUtils'
import * as types from '../types'

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks',
}

interface Props {
  targetDate: string // YYYY-MM-DD, the day currently being viewed
  // When set, this is a per-meal copy: the source list is filtered to this
  // meal and every copied entry is reassigned to it. Left undefined, this is
  // a whole-day copy — every meal from the source day comes along, and each
  // copy keeps its own meal.
  meal?: types.FoodLog['meal']
  onClose: () => void
  onCopied: () => void
}

export default function CopyMealModal({ targetDate, meal, onClose, onCopied }: Props) {
  const [sourceDate, setSourceDate] = useState(() => format(subDays(dayToLocalDate(targetDate), 1), 'yyyy-MM-dd'))
  const [entries, setEntries] = useState<types.FoodLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const visibleEntries = useMemo(
    () => meal ? entries.filter(e => e.meal === meal) : entries,
    [entries, meal],
  )

  const loadSource = useCallback(async (date: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await foodAPI.list(date)
      const list = data || []
      setEntries(list)
      const relevant = meal ? list.filter(e => e.meal === meal) : list
      setSelected(new Set(relevant.map(e => e.id)))
    } catch {
      setError('Failed to load that day')
      setEntries([])
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }, [meal])

  useEffect(() => { loadSource(sourceDate) }, [sourceDate, loadSource])

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = visibleEntries.length > 0 && visibleEntries.every(e => selected.has(e.id))
  const toggleAll = () => {
    setSelected(prev => {
      if (allSelected) {
        const next = new Set(prev)
        visibleEntries.forEach(e => next.delete(e.id))
        return next
      }
      return new Set([...prev, ...visibleEntries.map(e => e.id)])
    })
  }

  const handleCopy = async () => {
    if (selected.size === 0 || copying) return
    setCopying(true)
    setError(null)
    try {
      await foodAPI.copy([...selected], targetDate, meal)
      onCopied()
    } catch {
      setError('Failed to copy — try again')
      setCopying(false)
    }
  }

  const title = meal ? `Copy ${MEAL_LABELS[meal]}` : 'Copy day'
  const isToday = sourceDate === targetDate
  const quickDates = [1, 2, 7].map(n => format(subDays(dayToLocalDate(targetDate), n), 'yyyy-MM-dd'))

  return createPortal(
    <div className="fixed inset-0 z-50 bg-surface-base flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <Copy className="w-4 h-4 text-brand-500" />
          <p className="text-sm font-semibold text-tx-primary">{title}</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-muted transition-colors" aria-label="Close">
          <X className="w-5 h-5 text-tx-muted" />
        </button>
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
        <div className="space-y-2">
          <p className="text-xs font-medium text-tx-muted uppercase tracking-wide">Copy from</p>
          <div className="flex items-center gap-2 flex-wrap">
            {quickDates.map((d, i) => (
              <button
                key={d}
                onClick={() => setSourceDate(d)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  sourceDate === d
                    ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                    : 'border-surface-border text-tx-secondary hover:bg-surface-muted'
                }`}
              >
                {i === 0 ? 'Yesterday' : `${i + 1} days ago`}
              </button>
            ))}
            <input
              type="date"
              value={sourceDate}
              max={targetDate}
              onChange={e => e.target.value && setSourceDate(e.target.value)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-surface-border bg-transparent text-tx-secondary"
            />
          </div>
          {isToday && (
            <p className="text-[11px] text-amber-400">Source day is the same as the day you're copying into.</p>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 px-3.5 py-3 text-xs text-error-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-xs text-tx-muted">Loading…</div>
        ) : visibleEntries.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-tx-secondary">
              {meal ? `No ${MEAL_LABELS[meal].toLowerCase()} logged that day` : 'Nothing logged that day'}
            </p>
            <p className="text-xs text-tx-muted">Pick a different date above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={toggleAll}
              className="flex items-center gap-2 px-1 text-xs font-medium text-tx-secondary hover:text-tx-primary"
            >
              {allSelected ? <CheckSquare className="w-4 h-4 text-brand-400" /> : <Square className="w-4 h-4" />}
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
            <div className="divide-y divide-surface-border rounded-xl border border-surface-border overflow-hidden">
              {visibleEntries.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => toggle(entry.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-muted/50 transition-colors"
                >
                  {selected.has(entry.id) ? (
                    <CheckSquare className="w-4 h-4 text-brand-400 flex-shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-tx-muted flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-tx-primary truncate">{entry.name}</p>
                    {!meal && (
                      <p className="text-[10px] text-tx-muted">{MEAL_LABELS[entry.meal]}</p>
                    )}
                  </div>
                  <span className="text-xs text-tx-secondary tabular-nums flex-shrink-0">
                    {Math.round(entry.calories)} kcal
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-surface-border safe-area-bottom">
        <button
          onClick={handleCopy}
          disabled={selected.size === 0 || copying}
          className="btn-primary btn-lg w-full disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
          {copying ? 'Copying…' : `Copy ${selected.size || ''} ${selected.size === 1 ? 'item' : 'items'}`}
        </button>
      </div>
    </div>,
    document.body,
  )
}
