import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useWorkoutSession } from './workoutSession'
import * as types from '../types'

// The store fires a debounced PUT to the active-session API on every mutation;
// stub the network so the test doesn't depend on a backend.
vi.mock('../services/api', () => ({
  activeSessionAPI: { put: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue(null), delete: vi.fn().mockResolvedValue({}) },
  programAPI: { get: vi.fn(), update: vi.fn() },
}))

const timedExercise = {
  id: 1, name: 'Plank', muscle_group: 'core', category: 'strength',
  equipment: '', description: '', secondary_muscles: [], is_timed: true, default_duration_seconds: 60,
} as unknown as types.Exercise

function timedSession(): types.ActiveSessionExercise[] {
  return [{
    exercise_id: 1,
    exercise: timedExercise,
    notes: '',
    sets: [{ set_number: 1, target_reps: 0, target_weight: 0, actual_reps: 0, actual_weight: 0, completed: false }],
  }]
}

describe('workoutSession exercise timer', () => {
  beforeEach(() => {
    useWorkoutSession.getState().cancelSession()
  })

  it('starting the timer records duration/exercise/set position', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Core', timedSession())
    s.startExerciseTimer(60, 0, 0)

    const state = useWorkoutSession.getState()
    expect(state.exTimerDurationSec).toBe(60)
    expect(state.exTimerExIdx).toBe(0)
    expect(state.exTimerSetIdx).toBe(0)
    expect(state.exTimerEndsAt).not.toBeNull()
  })

  it('pausing parks the remaining time and nulls the live end stamp', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Core', timedSession())
    s.startExerciseTimer(60, 0, 0)
    s.pauseExerciseTimer()

    const state = useWorkoutSession.getState()
    expect(state.exTimerEndsAt).toBeNull()
    expect(state.exTimerPausedRemainingMs).not.toBeNull()
  })

  it('resuming restores a live end stamp and clears the paused flag', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Core', timedSession())
    s.startExerciseTimer(60, 0, 0)
    s.pauseExerciseTimer()
    s.resumeExerciseTimer()

    const state = useWorkoutSession.getState()
    expect(state.exTimerEndsAt).not.toBeNull()
    expect(state.exTimerPausedRemainingMs).toBeNull()
  })

  it('clearExerciseTimer resets all exercise-timer fields', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Core', timedSession())
    s.startExerciseTimer(60, 0, 0)
    s.clearExerciseTimer()

    const state = useWorkoutSession.getState()
    expect(state.exTimerEndsAt).toBeNull()
    expect(state.exTimerDurationSec).toBeNull()
    expect(state.exTimerExIdx).toBeNull()
    expect(state.exTimerSetIdx).toBeNull()
    expect(state.exTimerPausedRemainingMs).toBeNull()
  })

  it('removing a set invalidates a running exercise timer, like it does rest', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Core', timedSession())
    s.addSet(0)
    s.startExerciseTimer(60, 0, 1)
    s.removeSet(0, 0)

    const state = useWorkoutSession.getState()
    expect(state.exTimerExIdx).toBeNull()
    expect(state.exTimerSetIdx).toBeNull()
  })

  it('retagExercise flips a strength exercise to timed and remaps its sets', () => {
    const s = useWorkoutSession.getState()
    const strengthExercise = {
      id: 2, name: 'Ankle Circles', muscle_group: 'calves', category: 'strength',
      equipment: '', description: '', secondary_muscles: [],
    } as unknown as types.Exercise
    s.startSession('Mobility', [{
      exercise_id: 2,
      exercise: strengthExercise,
      notes: '',
      sets: [{ set_number: 1, target_reps: 10, target_weight: 25, actual_reps: 10, actual_weight: 25, completed: false }],
    }])

    const timedExercise = { ...strengthExercise, is_timed: true, default_duration_seconds: 20 }
    s.retagExercise(0, timedExercise)

    const state = useWorkoutSession.getState()
    const ex = state.session!.exercises[0]
    expect(ex.exercise.is_timed).toBe(true)
    expect(ex.sets[0].actual_reps).toBe(0)
    expect(ex.sets[0].actual_weight).toBe(0)
    expect(ex.sets[0].actual_duration).toBe(20)
  })

  it('retagExercise flips a timed exercise back to strength and clears duration', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Core', timedSession())
    s.updateSet(0, 0, 'actual_duration', 60)

    const strengthExercise = { ...timedExercise, is_timed: false, default_duration_seconds: 0 }
    s.retagExercise(0, strengthExercise)

    const ex = useWorkoutSession.getState().session!.exercises[0]
    expect(ex.exercise.is_timed).toBe(false)
    expect(ex.sets[0].actual_duration).toBe(0)
  })

  it('buildPayload records the logged duration on a timed set', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Core', timedSession())
    s.updateSet(0, 0, 'actual_duration', 60)

    const payload = useWorkoutSession.getState().buildPayload()
    const set = payload.exercises[0].sets[0]
    expect(set.duration).toBe(60)
    expect(set.reps).toBe(0)
    expect(set.weight).toBe(0)
  })
})
