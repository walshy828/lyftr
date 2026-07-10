import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('auth store initialization', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('corrupt stored user degrades to logged out instead of throwing', async () => {
    localStorage.setItem('access_token', 'tok')
    localStorage.setItem('user', '{definitely not json')

    const { useAuthStore } = await import('./auth')
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(localStorage.getItem('user')).toBeNull() // bad key cleaned up
  })

  it('valid stored user authenticates', async () => {
    localStorage.setItem('access_token', 'tok')
    localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }))

    const { useAuthStore } = await import('./auth')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('logout clears this device`s active-session state', async () => {
    localStorage.setItem('access_token', 'tok')
    localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }))
    localStorage.setItem('lyftr_active_session', '{"name":"Push Day"}')
    localStorage.setItem('lyftr_active_session_updated_at', '123')
    localStorage.setItem('lyftr_gym_ui', '{}')

    const { useAuthStore } = await import('./auth')
    const { useWorkoutSession } = await import('./workoutSession')
    useAuthStore.getState().logout()

    expect(localStorage.getItem('lyftr_active_session')).toBeNull()
    expect(localStorage.getItem('lyftr_active_session_updated_at')).toBeNull()
    expect(localStorage.getItem('lyftr_gym_ui')).toBeNull()
    expect(useWorkoutSession.getState().session).toBeNull()
  })
})
