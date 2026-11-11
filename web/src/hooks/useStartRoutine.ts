import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkoutSession } from '../stores/workoutSession'
import * as types from '../types'

/**
 * Starting a live workout, in one place. The Train sheet, the routine list,
 * the /workout/start deep link and the Today card all start sessions the same
 * way: copy the routine's targets into the session and open the logger.
 */
export function useStartRoutine() {
  const navigate = useNavigate()
  const { startSession } = useWorkoutSession()

  const startRoutine = useCallback((program: types.Program) => {
    const exercises: types.ActiveSessionExercise[] = (program.exercises || []).map(ex => ({
      exercise_id: ex.exercise_id,
      exercise: ex.exercise,
      notes: ex.notes || '',
      rest_seconds: ex.rest_seconds,
      sets: (ex.sets || []).map(s => ({
        set_number: s.set_number,
        target_reps: s.target_reps,
        target_weight: s.target_weight,
        actual_reps: s.target_reps,
        actual_weight: s.target_weight,
        actual_duration: s.target_duration_seconds || 0,
        completed: false,
      })),
    }))
    startSession(program.name, exercises, program.id)
    navigate('/workout/active')
  }, [navigate, startSession])

  const startEmpty = useCallback(() => {
    const name = `Workout — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    startSession(name, [])
    navigate('/workout/active')
  }, [navigate, startSession])

  return { startRoutine, startEmpty }
}
