import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Footprints, Zap, Bike, Waves, AlertCircle } from 'lucide-react'
import { exerciseAPI, workoutAPI } from '../services/api'
import { useSettingsStore, weightShort } from '../stores/settings'
import CardioEntry from './CardioEntry'
import * as types from '../types'

type Kind = 'walk' | 'run' | 'bike' | 'swim'

const KINDS: { kind: Kind; label: string; icon: typeof Footprints; keywords: string[] }[] = [
  { kind: 'walk', label: 'Walk', icon: Footprints, keywords: ['walk'] },
  { kind: 'run', label: 'Run', icon: Zap, keywords: ['run', 'jog'] },
  { kind: 'bike', label: 'Bike', icon: Bike, keywords: ['bicycl', 'cycling', 'bike', 'spinning'] },
  { kind: 'swim', label: 'Swim', icon: Waves, keywords: ['swim'] },
]

// Resolve a walk/run/bike/swim kind to the best cardio exercise in the
// library. Lyftr seeds a fixed, always-present "lyftr" row per kind (see
// backend/seed/exercises.go's lyftrCardioItems) specifically so this never
// depends on whichever third-party library (free-exercise-db vs the
// Gymvisual-sourced dataset) happens to be active — Gymvisual in particular
// has no outdoor walk/bike and no swim entry at all, so the old
// keyword-over-the-whole-catalog search could silently fail or match a
// stationary-machine variant after a library switch. The keyword search
// below only runs as a fallback, e.g. for an install that hasn't synced the
// carve-out yet.
function pickExercise(list: types.Exercise[], kind: Kind): types.Exercise | undefined {
  const native = list.find(e => e.source === 'lyftr' && e.source_id === `lyftr-${kind}`)
  if (native) return native

  const kw = KINDS.find(k => k.kind === kind)!.keywords
  const matches = list.filter(e => {
    const n = e.name.toLowerCase()
    return kw.some(k => n.includes(k))
  })
  if (matches.length === 0) return undefined
  const penalty = (name: string) =>
    /stationary|treadmill|trainer|machine|elliptical/i.test(name) ? 1 : 0
  return [...matches].sort(
    (a, b) => penalty(a.name) - penalty(b.name) || a.name.length - b.name.length,
  )[0]
}

interface QuickCardioModalProps {
  onClose: () => void
  onLogged?: (workout: types.Workout) => void
}

// One-form cardio logger: pick walk/run/bike, enter time + distance + steps
// (+ optional notes), and it creates a complete one-exercise workout in a
// single POST — no multi-step "start workout, add exercise" flow.
export default function QuickCardioModal({ onClose, onLogged }: QuickCardioModalProps) {
  const { settings } = useSettingsStore()
  const wUnit = weightShort(settings.weight_unit)

  const [exercises, setExercises] = useState<types.Exercise[]>([])
  const [kind, setKind] = useState<Kind>('walk')
  const [durationSec, setDurationSec] = useState(0)
  const [distanceMeters, setDistanceMeters] = useState(0)
  const [steps, setSteps] = useState(0)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    exerciseAPI.list({ category: 'cardio' })
      .then(setExercises)
      .catch(() => setError('Could not load cardio exercises'))
  }, [])

  const resolved = useMemo(() => pickExercise(exercises, kind), [exercises, kind])

  const handleSave = async () => {
    if (!resolved) { setError('No matching cardio exercise found. Try the full workout builder.'); return }
    if (!durationSec && !distanceMeters && !steps) { setError('Enter a time, distance, or steps first.'); return }
    setSaving(true)
    setError('')
    try {
      const label = KINDS.find(k => k.kind === kind)!.label
      const workout = await workoutAPI.create({
        name: label,
        notes,
        duration: durationSec,
        started_at: new Date().toISOString(),
        feeling: 0,
        exercises: [{
          exercise_id: resolved.id,
          notes: '',
          rest_seconds: 0,
          sets: [{ set_number: 1, reps: 0, weight: 0, duration: durationSec, distance: distanceMeters, steps, completed: true }],
        }],
      })
      onLogged?.(workout)
      onClose()
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-surface-base border border-surface-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="mx-auto w-10 h-1 rounded-full bg-surface-muted mb-4 sm:hidden" />
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-bold text-lg text-tx-primary">Quick cardio</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 hover:bg-surface-muted rounded-lg transition-colors">
            <X className="w-4 h-4 text-tx-muted" />
          </button>
        </div>

        {/* Activity picker */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          {KINDS.map(({ kind: k, label, icon: Icon }) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`flex flex-col items-center gap-2 py-4 rounded-xl border transition-all ${
                kind === k
                  ? 'bg-brand-500/15 border-brand-500/40 text-brand-400'
                  : 'bg-surface-muted/40 border-surface-border text-tx-secondary hover:border-brand-500/30'
              }`}
            >
              <Icon className="w-6 h-6" />
              <span className="text-sm font-semibold">{label}</span>
            </button>
          ))}
        </div>

        {resolved && (
          <p className="text-xs text-tx-muted mb-3 -mt-2">Logging as “{resolved.name}”</p>
        )}

        {/* Time / distance / steps */}
        <CardioEntry
          durationSec={durationSec}
          distanceMeters={distanceMeters}
          steps={steps}
          unit={wUnit}
          onDuration={setDurationSec}
          onDistance={setDistanceMeters}
          onSteps={setSteps}
        />

        {/* Notes */}
        <div className="mt-4">
          <label className="text-xs text-tx-muted font-medium uppercase tracking-wider block mb-1">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. easy pace around the park"
            className="input text-sm"
          />
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-xs text-error-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} disabled={saving} className="flex-1 py-3 bg-surface-muted hover:bg-surface-muted/80 disabled:opacity-50 text-tx-secondary rounded-xl transition-colors font-medium text-sm">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !resolved} className="flex-1 py-3 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-xl transition-colors font-semibold text-sm">
            {saving ? 'Saving…' : 'Log cardio'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
