import { useState } from 'react'
import { exerciseAPI } from '../../services/api'
import { KIND_META, MODALITIES, modalityOf } from '../../utils/trainingKinds'
import * as types from '../../types'

interface Props {
  exercise: types.Exercise
  onUpdated: (exercise: types.Exercise) => void
}

/**
 * Which training type this movement counts toward. Library-wide, like
 * TimedToggle: the type is inferred from the library's category and the name,
 * and this is where a wrong guess (e.g. "Ankle Circles" read as strength) gets
 * corrected once for every routine that uses it.
 */
export default function ModalityPicker({ exercise, onUpdated }: Props) {
  const [saving, setSaving] = useState(false)
  const current = modalityOf(exercise)

  const pick = async (m: types.Modality) => {
    if (m === current) return
    setSaving(true)
    try {
      onUpdated(await exerciseAPI.setModality(exercise.id, m))
    } catch {
      // best-effort, like TimedToggle: tapping again is the retry
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-4">
      <p className="text-sm text-tx-secondary mb-2">Counts toward</p>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Exercise type">
        {MODALITIES.map(m => {
          const meta = KIND_META[m]
          const on = current === m
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={saving}
              onClick={() => pick(m)}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold border transition-colors disabled:opacity-50 ${
                on ? `${meta.tint} border-current` : 'border-surface-border text-tx-muted hover:bg-surface-overlay'
              }`}
            >
              <meta.icon className="w-3.5 h-3.5" /> {meta.label}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-tx-muted mt-2">Applies everywhere this exercise is used. Routines can still be set to a different type.</p>
    </div>
  )
}
