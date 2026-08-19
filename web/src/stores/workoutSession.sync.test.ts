import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useWorkoutSession } from './workoutSession'
import * as types from '../types'

const putMock = vi.fn().mockResolvedValue({})
vi.mock('../services/api', () => ({
  activeSessionAPI: { put: (...args: any[]) => putMock(...args), get: vi.fn().mockResolvedValue(null), delete: vi.fn().mockResolvedValue({}) },
  programAPI: { get: vi.fn(), update: vi.fn() },
}))

const bigImage = `data:image/jpeg;base64,${'a'.repeat(500_000)}`

const exerciseWithPhoto = {
  id: 1, name: 'Custom Curl', muscle_group: 'arms', category: 'strength',
  equipment: '', description: 'a long description'.repeat(50), secondary_muscles: [],
  image_url: bigImage, image_url_end: bigImage, video_url: 'https://example.com/vid.mp4', gif_url: bigImage,
} as unknown as types.Exercise

describe('workoutSession server sync payload', () => {
  beforeEach(() => {
    putMock.mockClear()
    useWorkoutSession.getState().cancelSession()
  })

  it('strips heavy exercise fields (images/description) before syncing to the server', async () => {
    const s = useWorkoutSession.getState()
    s.startSession('Arms', [{
      exercise_id: 1,
      exercise: exerciseWithPhoto,
      notes: '',
      sets: [{ set_number: 1, target_reps: 10, target_weight: 50, actual_reps: 10, actual_weight: 50, completed: false }],
    }])

    await vi.waitFor(() => expect(putMock).toHaveBeenCalled())
    const synced = putMock.mock.calls[0][0]
    const syncedJson = JSON.stringify(synced)
    expect(syncedJson.length).toBeLessThan(5000)
    expect(synced.exercises[0].exercise.image_url).toBeUndefined()
    expect(synced.exercises[0].exercise.image_url_end).toBeUndefined()
    expect(synced.exercises[0].exercise.gif_url).toBeUndefined()
    expect(synced.exercises[0].exercise.video_url).toBeUndefined()
    expect(synced.exercises[0].exercise.description).toBeUndefined()
    // Fields a cross-device consumer (the watch companion) actually needs survive.
    expect(synced.exercises[0].exercise.name).toBe('Custom Curl')
    expect(synced.exercises[0].exercise.muscle_group).toBe('arms')
  })

  it('leaves the local (this-device) session copy fully intact, images included', () => {
    const s = useWorkoutSession.getState()
    s.startSession('Arms', [{
      exercise_id: 1,
      exercise: exerciseWithPhoto,
      notes: '',
      sets: [{ set_number: 1, target_reps: 10, target_weight: 50, actual_reps: 10, actual_weight: 50, completed: false }],
    }])
    expect(useWorkoutSession.getState().session!.exercises[0].exercise.image_url).toBe(bigImage)
  })
})
