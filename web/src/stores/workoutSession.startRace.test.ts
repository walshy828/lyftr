import { describe, it, expect, beforeEach, vi } from 'vitest'

// A poll answered before the new session's first PUT lands must not read as
// "ended on another device" — that tore down freshly started workouts and
// bounced the user from /workout/active to History.
let resolvePut: (() => void) | null = null
const putMock = vi.fn(() => new Promise<void>(r => { resolvePut = r }))
const getMock = vi.fn().mockResolvedValue(null)
vi.mock('../services/api', () => ({
  activeSessionAPI: { put: (...a: any[]) => putMock(...(a as [])), get: (...a: any[]) => getMock(...(a as [])), delete: vi.fn().mockResolvedValue({}) },
  programAPI: { get: vi.fn(), update: vi.fn() },
}))

import { useWorkoutSession, hydrateActiveSessionFromServer } from './workoutSession'

describe('hydrate racing a just-started session', () => {
  beforeEach(() => {
    localStorage.clear()
    putMock.mockClear()
    getMock.mockReset().mockResolvedValue(null)
    useWorkoutSession.setState({ session: null, endedRemotely: null })
  })

  it('keeps the session while its first push is still on the wire', async () => {
    useWorkoutSession.getState().startSession('Push A', [])
    await vi.waitFor(() => expect(putMock).toHaveBeenCalled())
    await hydrateActiveSessionFromServer()
    expect(useWorkoutSession.getState().session?.name).toBe('Push A')
    expect(useWorkoutSession.getState().endedRemotely).toBeNull()
    resolvePut?.()
  })

  it('still treats a missing server session as ended once our push has landed', async () => {
    useWorkoutSession.getState().startSession('Push A', [])
    await vi.waitFor(() => expect(putMock).toHaveBeenCalled())
    resolvePut?.()
    await new Promise(r => setTimeout(r, 5))
    await hydrateActiveSessionFromServer()
    expect(useWorkoutSession.getState().session).toBeNull()
    expect(useWorkoutSession.getState().endedRemotely).not.toBeNull()
  })
})
