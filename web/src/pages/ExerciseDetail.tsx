import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Dumbbell, Plus, Pencil } from 'lucide-react'
import { exerciseAPI } from '../services/api'
import { useWorkoutSession } from '../stores/workoutSession'
import ExerciseDetailContent from '../components/ExerciseDetailContent'
import AddToRoutineSheet from '../components/AddToRoutineSheet'
import CreateExerciseSheet from '../components/exercise/CreateExerciseSheet'
import * as types from '../types'
import { formatExerciseName } from '../utils/exerciseUtils'

export default function ExerciseDetail() {
  const { exerciseId } = useParams<{ exerciseId: string }>()
  const navigate = useNavigate()
  const { session } = useWorkoutSession()
  const [exercise, setExercise] = useState<types.Exercise | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPlanSheet, setShowPlanSheet] = useState(false)
  const [showEditSheet, setShowEditSheet] = useState(false)

  useEffect(() => {
    const id = Number(exerciseId)
    if (!id) { navigate(-1); return }

    const fromSession = session?.exercises.find(e => e.exercise_id === id)?.exercise

    const exercisePromise = fromSession
      ? Promise.resolve(fromSession)
      : exerciseAPI.get(id)

    exercisePromise
      .then(ex => setExercise(ex))
      .catch(() => navigate(-1))
      .finally(() => setLoading(false))
  }, [exerciseId])

  if (loading || !exercise) {
    return (
      <div className="flex items-center justify-center py-20">
        <Dumbbell className="w-6 h-6 text-brand-500 animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-slide-up pb-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-surface-muted rounded-lg transition-colors mt-0.5 flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5 text-tx-muted" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-2xl text-tx-primary leading-tight">{formatExerciseName(exercise.name)}</h1>
        </div>
        {exercise.source === 'custom' && (
          <button
            onClick={() => setShowEditSheet(true)}
            className="btn-secondary btn-sm flex-shrink-0 mt-0.5"
            aria-label="Edit exercise"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => setShowPlanSheet(true)}
          className="btn-secondary btn-sm flex-shrink-0 mt-0.5"
        >
          <Plus className="w-3.5 h-3.5" /> Plan
        </button>
      </div>

      <ExerciseDetailContent exercise={exercise} onExerciseUpdated={setExercise} />

      {showPlanSheet && <AddToRoutineSheet exercise={exercise} onClose={() => setShowPlanSheet(false)} />}
      {showEditSheet && (
        <CreateExerciseSheet
          exercise={exercise}
          onClose={() => setShowEditSheet(false)}
          onSaved={updated => { setExercise(updated); setShowEditSheet(false) }}
          onDeleted={() => navigate(-1)}
        />
      )}
    </div>
  )
}
