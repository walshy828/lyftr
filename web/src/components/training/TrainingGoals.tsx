import { useEffect, useState } from 'react'
import { Minus, Plus, Target, Check } from 'lucide-react'
import Sheet from '../ui/Sheet'
import { trainingAPI } from '../../services/api'
import { KIND_META } from '../../utils/trainingKinds'
import type { GoalProgress } from '../../utils/trainWeek'
import type { Modality, TrainingGoal } from '../../types'

/**
 * Starting points, so nobody has to know the guidelines to set sensible goals.
 * "Balanced" is the 3 lift / 3 cardio / daily stretch week; "Minimum" is the
 * common public-health floor (2 strength days covering the major muscle
 * groups, 150 min of moderate cardio, stretching a few days a week).
 */
const PRESETS: { name: string; sub: string; goals: TrainingGoal[] }[] = [
  {
    name: 'Balanced week', sub: '3 lift · 3 cardio · stretch daily',
    goals: [
      { kind: 'strength', days_per_week: 3, minutes_per_week: 0 },
      { kind: 'cardio', days_per_week: 3, minutes_per_week: 150 },
      { kind: 'mobility', days_per_week: 7, minutes_per_week: 70 },
    ],
  },
  {
    name: 'Guideline minimum', sub: '2 lift · 150 min cardio · stretch 3×',
    goals: [
      { kind: 'strength', days_per_week: 2, minutes_per_week: 0 },
      { kind: 'cardio', days_per_week: 0, minutes_per_week: 150 },
      { kind: 'mobility', days_per_week: 3, minutes_per_week: 0 },
    ],
  },
  {
    name: 'Strength focus', sub: '4 lift · 2 cardio · stretch 4×',
    goals: [
      { kind: 'strength', days_per_week: 4, minutes_per_week: 0 },
      { kind: 'cardio', days_per_week: 2, minutes_per_week: 90 },
      { kind: 'mobility', days_per_week: 4, minutes_per_week: 40 },
    ],
  },
]

const same = (a: TrainingGoal[], b: TrainingGoal[]) =>
  a.every(g => {
    const o = b.find(x => x.kind === g.kind)
    return o && o.days_per_week === g.days_per_week && o.minutes_per_week === g.minutes_per_week
  })

/** This week, per type, against its goal. Tapping opens the editor. */
export function GoalBars({ progress, onEdit }: { progress: GoalProgress[]; onEdit: () => void }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="eyebrow flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Weekly goals</p>
        <button onClick={onEdit} className="text-xs text-brand-400">Edit</button>
      </div>
      {progress.map(p => {
        const m = KIND_META[p.kind]
        return (
          <div key={p.kind} className="flex items-center gap-2.5">
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${m.tint}`}>
              <m.icon className="w-3.5 h-3.5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-tx-primary">{m.label}</span>
                <span className="text-xs text-tx-muted tabular-nums flex items-center gap-1">
                  {p.met && <Check className={`w-3 h-3 ${m.text}`} strokeWidth={3} />}
                  {p.label}
                </span>
              </div>
              <div
                className="h-1.5 rounded-full bg-surface-overlay mt-1 overflow-hidden"
                role="progressbar" aria-label={`${m.label} goal`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.ratio * 100)}
              >
                <div className={`h-full rounded-full ${m.bg} transition-[width] duration-500`} style={{ width: `${p.ratio * 100}%` }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface SheetProps {
  isOpen: boolean
  goals: TrainingGoal[]
  onClose: () => void
  onSaved: (goals: TrainingGoal[]) => void
}

export function GoalsSheet({ isOpen, goals, onClose, onSaved }: SheetProps) {
  const [draft, setDraft] = useState<TrainingGoal[]>(goals)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (isOpen) { setDraft(goals); setError('') } }, [isOpen, goals])

  const set = (kind: Modality, patch: Partial<TrainingGoal>) =>
    setDraft(prev => prev.map(g => g.kind === kind ? { ...g, ...patch } : g))

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      onSaved(await trainingAPI.saveGoals(draft))
      onClose()
    } catch {
      setError('Could not save goals')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Weekly goals" icon={<Target className="w-4 h-4 text-brand-500" />}>
      <div className="p-5 space-y-5">
        <div>
          <p className="label mb-2">Start from</p>
          <div className="grid gap-2">
            {PRESETS.map(p => {
              const on = same(p.goals, draft)
              return (
                <button key={p.name} type="button" onClick={() => setDraft(p.goals)}
                  className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${on ? 'border-brand-500 bg-brand-500/10' : 'border-surface-border hover:bg-surface-overlay'}`}>
                  <span className="block text-sm font-semibold text-tx-primary">{p.name}</span>
                  <span className="block text-xs text-tx-muted">{p.sub}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-3">
          {draft.map(g => {
            const m = KIND_META[g.kind]
            return (
              <div key={g.kind} className="card p-3">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${m.tint}`}><m.icon className="w-3.5 h-3.5" /></span>
                  <span className="text-sm font-semibold text-tx-primary">{m.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] text-tx-muted mb-1">Days / week</p>
                    <div className="flex items-center gap-1.5">
                      <button type="button" aria-label={`Fewer ${m.label} days`} onClick={() => set(g.kind, { days_per_week: Math.max(0, g.days_per_week - 1) })}
                        className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center text-tx-secondary"><Minus className="w-4 h-4" /></button>
                      <span className="flex-1 text-center text-lg font-bold tabular-nums text-tx-primary" aria-label={`${m.label} days per week`}>{g.days_per_week || '—'}</span>
                      <button type="button" aria-label={`More ${m.label} days`} onClick={() => set(g.kind, { days_per_week: Math.min(7, g.days_per_week + 1) })}
                        className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center text-tx-secondary"><Plus className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <label className="block">
                    <span className="block text-[11px] text-tx-muted mb-1">Minutes / week</span>
                    <input
                      type="number" inputMode="numeric" min={0} max={10080} step={10}
                      value={g.minutes_per_week || ''} placeholder="—"
                      onChange={e => set(g.kind, { minutes_per_week: Math.max(0, Math.min(10080, Number(e.target.value) || 0)) })}
                      className="input text-center h-8"
                      aria-label={`${m.label} minutes per week`}
                    />
                  </label>
                </div>
                <p className="text-[11px] text-tx-muted mt-2">{m.blurb}.</p>
              </div>
            )
          })}
        </div>

        {error && <p className="text-sm text-heart">{error}</p>}
        <button type="button" onClick={save} disabled={saving} className="btn-primary btn-md w-full">
          {saving ? 'Saving…' : 'Save goals'}
        </button>
      </div>
    </Sheet>
  )
}
