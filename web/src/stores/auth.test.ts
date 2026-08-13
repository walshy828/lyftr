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

  // Helper: a token whose payload decodes but whose signature is meaningless —
  // all the client ever inspects.
  const jwtExpiring = (secondsFromNow: number) => {
    const b64url = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const exp = Math.floor(Date.now() / 1000) + secondsFromNow
    return `${b64url({ alg: 'HS256' })}.${b64url({ exp })}.sig`
  }

  it('a still-valid access token keeps you signed in after the refresh token lapses', async () => {
    // Long sessions made this reachable: the refresh token can expire while the
    // access token has minutes left. Signing out immediately would throw away a
    // credential the server would still have honoured.
    localStorage.setItem('access_token', jwtExpiring(1800))
    localStorage.setItem('refresh_token', jwtExpiring(-60))
    localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }))

    const { useAuthStore } = await import('./auth')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('both tokens expired degrades to logged out', async () => {
    localStorage.setItem('access_token', jwtExpiring(-3600))
    localStorage.setItem('refresh_token', jwtExpiring(-60))
    localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }))

    const { useAuthStore } = await import('./auth')
    const state = useAuthStore.getState()
    // Rendering the app shell here would only flash it and bounce to /login.
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
  })

  it('an expired access token still authenticates while the refresh token lives', async () => {
    localStorage.setItem('access_token', jwtExpiring(-60))
    localStorage.setItem('refresh_token', jwtExpiring(60 * 60 * 24 * 30))
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
