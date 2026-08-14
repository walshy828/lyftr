import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Sheet } from '../ui'
import { exerciseAPI, apiErrorMessage } from '../../services/api'
import { BODY_PART_GROUPS } from '../../utils/exerciseUtils'
import * as types from '../../types'

interface Props {
  onClose: () => void
  onCreated: (exercise: types.Exercise) => void
}

/**
 * "Create your own exercise": name + body part only, no animation. Body part
 * is a canonical muscle_group per BODY_PART_GROUPS group (e.g. "Upper Arms"
 * saves as "biceps") rather than a free-text field — that's what makes the
 * result show up under the right tab and muscle-color chip everywhere else
 * in the app that reads muscle_group.
 */
export default function CreateExerciseSheet({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [bodyPart, setBodyPart] = useState(BODY_PART_GROUPS[0].key)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const group = BODY_PART_GROUPS.find(g => g.key === bodyPart)
    setSaving(true)
    setError(null)
    try {
      const exercise = await exerciseAPI.create({ name: trimmed, muscle_group: group?.muscleGroups[0] ?? bodyPart })
      onCreated(exercise)
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create exercise.'))
      setSaving(false)
    }
  }

  return (
    <Sheet isOpen onClose={onClose} title="Create your own exercise" icon={<Sparkles className="w-4 h-4 text-brand-500" />}>
      <div className="p-5">
        {error && (
          <div className="alert-error mb-4">
            <span>{error}</span>
          </div>
        )}
        <label className="block mb-4">
          <span className="text-xs font-medium text-tx-muted mb-1 block">Name</span>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Sled Push"
            className="input w-full"
          />
        </label>
        <div className="mb-6">
          <span className="text-xs font-medium text-tx-muted mb-1 block">Body part</span>
          <div className="flex gap-2 flex-wrap">
            {BODY_PART_GROUPS.map(group => (
              <button
                key={group.key}
                type="button"
                onClick={() => setBodyPart(group.key)}
                className={bodyPart === group.key ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 bg-surface-muted hover:bg-surface-muted/80 text-tx-secondary rounded-xl transition-colors font-medium text-sm">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            className="flex-1 py-3 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-xl transition-colors font-semibold text-sm"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
