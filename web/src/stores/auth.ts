import { create } from 'zustand'
import * as types from '../types'
import { authAPI } from '../services/api'
import { clearLocalSession } from './workoutSession'

interface AuthStore {
  user: types.User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login:     (email: string, password: string) => Promise<void>
  register:  (email: string, password: string) => Promise<void>
  logout:    () => void
  clearError: () => void
}

export const useAuthStore = create<AuthStore>((set) => {
  const token   = localStorage.getItem('access_token')
  // A corrupt stored user must degrade to "logged out", not throw at module
  // load and blank the whole app.
  let user: types.User | null = null
  try {
    const userStr = localStorage.getItem('user')
    user = userStr ? JSON.parse(userStr) : null
  } catch {
    localStorage.removeItem('user')
  }

  return {
    user,
    isAuthenticated: !!token && !!user,
    isLoading: false,
    error: null,

    login: async (email, password) => {
      set({ isLoading: true, error: null })
      try {
        const data = await authAPI.login({ email, password })
        localStorage.setItem('access_token', data.token)
        localStorage.setItem('refresh_token', data.refresh_token)
        localStorage.setItem('user', JSON.stringify(data.user))
        set({ user: data.user, isAuthenticated: true, isLoading: false })
      } catch (err: any) {
        set({ error: err.response?.data?.error || 'Login failed', isLoading: false })
        throw err
      }
    },

    register: async (email, password) => {
      set({ isLoading: true, error: null })
      try {
        const data = await authAPI.register({ email, password })
        localStorage.setItem('access_token', data.token)
        localStorage.setItem('refresh_token', data.refresh_token)
        localStorage.setItem('user', JSON.stringify(data.user))
        set({ user: data.user, isAuthenticated: true, isLoading: false })
      } catch (err: any) {
        set({ error: err.response?.data?.error || 'Registration failed', isLoading: false })
        throw err
      }
    },

    logout: () => {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('user')
      // Drop this device's copy of any in-progress workout so it can't leak
      // into a different account's session on the same browser. Server-side
      // state is left alone — the workout may still be live on the watch.
      clearLocalSession()
      // Defense in depth: the service worker never caches /api/*, but purge
      // Cache Storage anyway so no stale app-shell entry survives a user
      // switch on a shared device. Re-fetched/re-cached on next load.
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
      }
      set({ user: null, isAuthenticated: false, error: null })
    },

    clearError: () => set({ error: null }),
  }
})
