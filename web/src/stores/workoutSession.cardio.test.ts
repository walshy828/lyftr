import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useWorkoutSession } from './workoutSession'
import * as types from '../types'

// The store fires a debounced PUT to the active-session API on every mutation;
// stub the network so the test doesn't depend on a backend.
vi.mock('../services/api', () => ({
  activeSessionAPI: { put: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue(null), delete: vi.fn().mockResolvedValue({}) },
  programAPI: { get: vi.fn(), update: vi.fn() },
}))

const cardioExercise = {
  id: 1, name: 'Walking', muscle_group: 'cardio', category: 'cardio',
  equipment: '', description: '', secondary_muscles: [],
} as unknown as types.Exercise

function cardioSession(): types.ActiveSessionExercise[] {
  return [{
    exercise_id: 1,
    exercise: cardioExercise,
    notes: '',
    sets: [{ set_number: 1, target_reps: 0, target_weight: 0, actual_reps: 0, actual_weight: 0, completed: false }],
  }]
}

describe('workoutSession cardio plumbing', () => {
  beforeEach(() => {
    useWorkoutSession.getState().cancelSession()
  })

  it('buildPayload emits duration/distance/steps for a cardio entry', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Walk', cardioSession())
    s.updateSet(0, 0, 'actual_duration', 1800)
    s.updateSet(0, 0, 'actual_distance', 3200)
    s.updateSet(0, 0, 'actual_steps', 5400)

    const payload = useWorkoutSession.getState().buildPayload()
    const set = payload.exercises[0].sets[0]
    expect(set.duration).toBe(1800)
    expect(set.distance).toBe(3200)
    expect(set.steps).toBe(5400)
    // Cardio carries no reps/weight.
    expect(set.reps).toBe(0)
    expect(set.weight).toBe(0)
  })

  it('updating a cardio field does not run weight propagation', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Walk', cardioSession())
    s.updateSet(0, 0, 'actual_distance', 3200)
    const set = useWorkoutSession.getState().session!.exercises[0].sets[0]
    expect(set.actual_distance).toBe(3200)
    expect(set.actual_weight).toBe(0)
  })
})
