import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Dumbbell } from 'lucide-react'
import { programAPI } from '../services/api'
import { useSettingsStore, lbsToDisplay } from '../stores/settings'
import ProgramEditor, { type ProgramFormData } from '../components/ProgramEditor'
import * as types from '../types'

/**
 * Edit a routine. A thin loader around the shared ProgramEditor — this page
 * used to carry its own copy of the form, which had drifted: it dropped
 * target_duration_seconds, so saving a routine of timed stretches silently
 * zeroed every hold time.
 */
export default function EditProgram() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { settings } = useSettingsStore()
  const [initial, setInitial] = useState<{ data: ProgramFormData; exercises: Record<number, types.Exercise> } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const programId = Number(id)
    if (!programId) { navigate('/plan'); return }
    programAPI.get(programId)
      .then(p => {
        const map: Record<number, types.Exercise> = {}
        ;(p.exercises || []).forEach(ex => { map[ex.exercise_id] = ex.exercise })
        setInitial({
          exercises: map,
          data: {
            name: p.name,
            notes: p.notes || '',
            kind: p.kind,
            exercises: (p.exercises || []).map(ex => ({
              exercise_id: ex.exercise_id,
              notes: ex.notes || '',
              rest_seconds: ex.rest_seconds ?? (settings.rest_seconds_default ?? 90),
              sets: (ex.sets || []).map(s => ({
                set_number: s.set_number,
                target_reps: s.target_reps,
                target_weight: lbsToDisplay(s.target_weight, settings.weight_unit),
                target_duration_seconds: s.target_duration_seconds,
              })),
            })),
          },
        })
      })
      .catch(() => setError('Failed to load program'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (error) return <div className="alert-error mt-6">{error}</div>
  if (!initial) {
    return (
      <div className="flex items-center justify-center py-20">
        <Dumbbell className="w-6 h-6 text-brand-500 animate-pulse" />
      </div>
    )
  }

  return (
    <ProgramEditor
      title="Edit Program"
      initialData={initial.data}
      initialPickerExercises={initial.exercises}
      saveLabel="Save Changes"
      onSave={async payload => {
        await programAPI.update(Number(id), payload)
        navigate(`/programs/${id}`)
      }}
      onCancel={() => navigate(-1)}
    />
  )
}
