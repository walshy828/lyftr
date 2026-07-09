import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Dumbbell } from 'lucide-react'
import { exerciseAPI } from '../services/api'
import { useWorkoutSession } from '../stores/workoutSession'
import ExerciseDetailContent from '../components/ExerciseDetailContent'
import * as types from '../types'
import { muscleColorBordered } from '../utils/exerciseUtils'

export default function ExerciseDetail() {
  const { exerciseId } = useParams<{ exerciseId: string }>()
  const navigate = useNavigate()
  const { session } = useWorkoutSession()
  const [exercise, setExercise] = useState<types.Exercise | null>(null)
  const [loading, setLoading] = useState(true)

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
          <h1 className="font-display font-bold text-2xl text-tx-primary leading-tight">{exercise.name}</h1>
          <span className={`inline-flex items-center mt-1.5 px-2 py-0.5 rounded text-xs font-medium border ${muscleColorBordered(exercise.muscle_group)}`}>
            {exercise.muscle_group}
          </span>
        </div>
      </div>

      <ExerciseDetailContent exercise={exercise} />
    </div>
  )
}
