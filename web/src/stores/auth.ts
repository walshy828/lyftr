import { create } from 'zustand'
import * as types from '../types'
import { authAPI, ensureFreshToken, hasRedeemableSession } from '../services/api'
import { clearLocalSession } from './workoutSession'

// Ask the browser to exempt our origin from routine storage eviction. On iOS
// this matters more than anywhere else: Safari's ITP clears script-writable
// storage for sites unused for ~7 days, which would silently log you out of an
// installed PWA even while a perfectly good refresh token sits in localStorage.
// Best-effort and silent — no browser is obliged to say yes.
const requestPersistentStorage = () => {
  navigator.storage?.persist?.().catch(() => {})
}

interface AuthStore {
  user: types.User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login:     (email: string, password: string, remember?: boolean) => Promise<void>
  register:  (email: string, password: string, inviteCode?: string) => Promise<void>
  logout:    () => void
  clearError: () => void
  // Replace the cached user (e.g. after a profile edit or a fresh /me fetch)
  // and mirror it to localStorage so it survives a reload.
  setUser:   (user: types.User) => void
}

export const useAuthStore = create<AuthStore>((set) => {
  // A corrupt stored user must degrade to "logged out", not throw at module
  // load and blank the whole app.
  let user: types.User | null = null
  try {
    const userStr = localStorage.getItem('user')
    user = userStr ? JSON.parse(userStr) : null
  } catch {
    localStorage.removeItem('user')
  }

  // Presence of an access token is not the question — it expires hourly and is
  // routinely stale at boot. What decides whether we can show the app is
  // whether the *refresh* token can still be redeemed; if it can't, render the
  // login page now instead of flashing the shell and redirecting.
  const restorable = hasRedeemableSession() && !!user

  return {
    user: restorable ? user : null,
    isAuthenticated: restorable,
    isLoading: false,
    error: null,

    login: async (email, password, remember = true) => {
      set({ isLoading: true, error: null })
      try {
        const data = await authAPI.login({ email, password, remember })
        localStorage.setItem('access_token', data.token)
        localStorage.setItem('refresh_token', data.refresh_token)
        localStorage.setItem('user', JSON.stringify(data.user))
        requestPersistentStorage()
        set({ user: data.user, isAuthenticated: true, isLoading: false })
      } catch (err: any) {
        set({ error: err.response?.data?.error || 'Login failed', isLoading: false })
        throw err
      }
    },

    register: async (email, password, inviteCode) => {
      set({ isLoading: true, error: null })
      try {
        const data = await authAPI.register({ email, password, ...(inviteCode ? { invite_code: inviteCode } : {}) })
        localStorage.setItem('access_token', data.token)
        localStorage.setItem('refresh_token', data.refresh_token)
        localStorage.setItem('user', JSON.stringify(data.user))
        requestPersistentStorage()
        set({ user: data.user, isAuthenticated: true, isLoading: false })
      } catch (err: any) {
        set({ error: err.response?.data?.error || 'Registration failed', isLoading: false })
        throw err
      }
    },

    logout: () => {
      // Fire-and-forget: revoke server-side so the tokens are dead even if a
      // copy was exfiltrated. Local state is cleared regardless of the result —
      // a user clicking "log out" must always end up logged out locally, even
      // offline or with an already-expired token.
      const refreshToken = localStorage.getItem('refresh_token')
      authAPI.logout(refreshToken).catch(() => {})

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

    setUser: (user) => {
      localStorage.setItem('user', JSON.stringify(user))
      set({ user })
    },
  }
})

// ─── Cross-tab and resume behaviour ─────────────────────────────────────────
//
// Refresh tokens rotate and the spent one is revoked server-side, so two tabs
// refreshing at once can hand each other a dead token. localStorage `storage`
// events only fire in *other* tabs, which is exactly the signal needed: adopt
// whatever the active tab just wrote instead of racing it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'refresh_token' && e.newValue === null) {
      // Another tab logged out. Drop this tab's session too rather than leaving
      // a shell running against tokens that no longer exist.
      useAuthStore.setState({ user: null, isAuthenticated: false, error: null })
      return
    }
    if (e.key === 'user' && e.newValue) {
      try {
        useAuthStore.setState({ user: JSON.parse(e.newValue), isAuthenticated: true })
      } catch {
        /* another tab wrote something unparseable; ignore */
      }
    }
  })

  // Coming back to a backgrounded PWA is the moment the access token is most
  // likely to be stale, and the moment a wasted 401 is most visible. Renew
  // before the first request rather than after it fails.
  const renewOnResume = () => {
    if (document.hidden) return
    if (!useAuthStore.getState().isAuthenticated) return
    ensureFreshToken()
  }
  document.addEventListener('visibilitychange', renewOnResume)
  window.addEventListener('focus', renewOnResume)
}
