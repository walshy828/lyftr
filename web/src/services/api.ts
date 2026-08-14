import axios, { AxiosInstance } from 'axios'
import * as types from '../types'
import { normalizeServerUrl } from '../stores/server'
import { isExpired, isExpiringSoon } from '../utils/token'

// Every API call lives under this versioned path. `origin` is an absolute server
// origin for a cross-origin backend, or '' for the same-origin reverse proxy.
const API_BASE_PATH = '/api/v1'
export const apiUrl = (origin = '') => `${origin}${API_BASE_PATH}`

// Resolved per-request so the "Server settings" panel takes effect immediately,
// without needing a full page reload.
const resolveAPIBase = () => {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined
  if (envUrl) return envUrl
  // Re-normalize in case localStorage holds a legacy/scheme-less value: a relative
  // base would make axios fold the host into the request path (bogus 405s), so fall
  // back to the same-origin reverse proxy when it can't be made absolute.
  const stored = localStorage.getItem('server_url')
  const base = stored ? normalizeServerUrl(stored) : ''
  return apiUrl(base)
}

/**
 * Absolute URL for a REST path, honouring the configured backend.
 *
 * Needed for anything the browser fetches outside axios — notably <img src>,
 * which would otherwise resolve a relative path against the frontend's origin
 * and miss a remote backend entirely.
 */
export const apiAssetUrl = (path: string) => `${resolveAPIBase()}${path}`

// Turn an axios error into an actionable message. Network/CORS/connection failures
// (no response) and proxy misconfig (404/405) are distinguished from real auth and
// server errors, so connectivity problems don't masquerade as "Registration failed."
// Intended for the auth/connectivity flows (login/register/connection test); the
// 404/405 wording assumes a misconfigured server URL rather than a missing resource.
export const apiErrorMessage = (err: any, fallback: string): string => {
  if (err?.response) {
    const serverError = err.response.data?.error
    if (serverError) return serverError
    const status = err.response.status
    if (status === 404 || status === 405) {
      return "Server URL looks misconfigured — the API endpoint wasn't found. Check Server settings."
    }
    if (status >= 500) return 'Server error. Please try again shortly.'
    return fallback
  }
  return "Can't reach the server. Check the URL, that the backend is running, and that it allows this app's origin (CORS)."
}

export interface ServerInfo {
  name: string
  version: string
  /**
   * Whether the server has a WebAuthn Relying Party configured. Needed before
   * anyone is authenticated, to decide whether to offer passkey sign-in at all.
   * Absent on servers older than the feature, which reads as false.
   */
  passkeys_enabled?: boolean
}

// Probes a server's public /info endpoint to confirm it's reachable and is a
// Lyftr backend. Pass '' to test the same-origin reverse-proxy path. Runs under
// the backend's CORS policy, so success predicts that real requests will work.
export const testServerConnection = async (
  base: string,
): Promise<{ ok: true; info: ServerInfo } | { ok: false; message: string }> => {
  try {
    const res = await axios.get<{ data: ServerInfo }>(`${apiUrl(base)}/info`, { timeout: 8000 })
    const info = res.data?.data
    if (!info?.name) {
      return { ok: false, message: "That responded, but it doesn't look like a Lyftr server." }
    }
    return { ok: true, info }
  } catch (err) {
    return { ok: false, message: apiErrorMessage(err, "Couldn't reach the server.") }
  }
}

const api: AxiosInstance = axios.create({
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use(async (config) => {
  config.baseURL = resolveAPIBase()
  // Renew before the request rather than after a 401. The reactive path still
  // exists as a backstop, but on its own it means every cold start of the PWA
  // pays a wasted round-trip, and a request that fires mid-set gets retried at
  // exactly the moment gym wifi is least willing to cooperate.
  // Auth endpoints are skipped: /auth/refresh is what we'd be calling, and
  // login/register have no session to keep fresh.
  if (!(config.url || '').includes('/auth/')) {
    await ensureFreshToken()
  }
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Single in-flight refresh shared by every 401 — when a burst of parallel
// requests all expire together, only the first triggers POST /auth/refresh
// and the rest await the same promise (the backend also rate-limits /auth/*,
// so a refresh stampede would get itself 429'd).
let _refreshPromise: Promise<string> | null = null

export const refreshAccessToken = (): Promise<string> => {
  _refreshPromise ??= (async () => {
    try {
      const refreshToken = localStorage.getItem('refresh_token')
      const res = await axios.post(`${resolveAPIBase()}/auth/refresh`, { refresh_token: refreshToken })
      const newToken = res.data.data.token
      localStorage.setItem('access_token', newToken)
      if (res.data.data.refresh_token) {
        localStorage.setItem('refresh_token', res.data.data.refresh_token)
      }
      return newToken
    } finally {
      _refreshPromise = null
    }
  })()
  return _refreshPromise
}

// Refresh only if the access token is close enough to expiry to be worth it,
// collapsing onto the same in-flight promise as the 401 path. Never rejects:
// a failed pre-emptive refresh should let the request proceed and be judged by
// the server, not blow up a call that might have succeeded anyway.
export const ensureFreshToken = async (): Promise<void> => {
  if (!localStorage.getItem('refresh_token')) return
  if (!isExpiringSoon(localStorage.getItem('access_token'))) return
  try {
    await refreshAccessToken()
  } catch {
    /* fall through to the reactive 401 handler */
  }
}

// True when this browser still holds a credential worth trying. Used at boot so
// an obviously dead session renders the login page directly instead of flashing
// the app shell and bouncing a moment later.
//
// Either token will do, and the test is "not demonstrably expired" rather than
// "present": a refresh token that lapsed while an access token is still good
// should keep you working until that one dies too, and a token whose expiry
// can't be read (opaque, or not a JWT) is given the benefit of the doubt —
// the server is the authority, and guessing "logged out" here would sign
// people out over a parsing failure.
export const hasRedeemableSession = (): boolean => {
  const access = localStorage.getItem('access_token')
  const refresh = localStorage.getItem('refresh_token')
  if (refresh && !isExpired(refresh)) return true
  return !!access && !isExpired(access)
}

// Ends the session locally and sends the user to the login page with an
// explanation. The bare redirect this replaces dropped people on a blank login
// form with no hint that anything had expired, which reads as a bug.
export const endSessionAndRedirect = (reason: 'expired' | 'revoked' = 'expired') => {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('user')
  if (window.location.pathname !== '/login') {
    window.location.href = `/login?reason=${reason}`
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    // A 401 from the auth endpoints themselves is a credential error, not an
    // expired session — let the page show it instead of attempting a token
    // refresh and redirecting (which would wipe "Invalid email or password").
    const isAuthRequest = (original?.url || '').includes('/auth/')
    if (error.response?.status === 401 && !original._retry && !isAuthRequest) {
      original._retry = true
      try {
        const newToken = await refreshAccessToken()
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)
      } catch {
        endSessionAndRedirect('expired')
      }
    }
    return Promise.reject(error)
  }
)

const unwrap = <T>(res: { data: { data: T } }) => res.data.data

export const authAPI = {
  login:    (data: types.LoginRequest)    => api.post<{ data: types.AuthResponse }>('/auth/login', data).then(res => unwrap(res)),
  register: (data: types.RegisterRequest) => api.post<{ data: types.AuthResponse }>('/auth/register', data).then(res => unwrap(res)),
  // Revokes this session's tokens server-side. Clearing localStorage alone left
  // a stolen refresh token usable for its full lifetime.
  logout:   (refreshToken: string | null) => api.post('/auth/logout', { refresh_token: refreshToken ?? '' }),
}

export const userAPI = {
  me:             ()                             => api.get<{ data: types.User }>('/me').then(res => unwrap(res)),
  updateMe:       (data: { name: string })       => api.put<{ data: types.User }>('/me', data).then(res => unwrap(res)),
  getSettings:    ()                             => api.get<{ data: types.UserSettings }>('/settings').then(res => unwrap(res)),
  updateSettings: (data: Partial<types.UserSettings>) => api.put<{ data: types.UserSettings }>('/settings', data).then(res => unwrap(res)),
  deleteAccount:  ()                             => api.delete('/me'),
  // Returns a fresh token pair: changing the password invalidates every
  // session, including the one making the request.
  changePassword: (data: types.ChangePasswordRequest) =>
    api.put<{ data: types.AuthResponse }>('/me/password', data).then(res => unwrap(res)),
}

export const workoutAPI = {
  list:   (params?: { limit?: number; offset?: number; q?: string }) =>
    api.get<{ data: types.Workout[] }>('/workouts', { params }).then(res => unwrap(res)),
  get:    (id: number) => api.get<{ data: types.Workout }>(`/workouts/${id}`).then(res => unwrap(res)),
  create: (data: any) => api.post<{ data: types.Workout }>('/workouts', data).then(res => unwrap(res)),
  update: (id: number, data: any) => api.put<{ data: types.Workout }>(`/workouts/${id}`, data).then(res => unwrap(res)),
  delete: (id: number) => api.delete(`/workouts/${id}`),
  /**
   * Server-side training aggregates over a date window.
   *
   * `tz_offset` is always sent: the server stores no per-user timezone, so the
   * browser is the only authority on where its own day boundary falls. Without
   * it an evening session lands on the wrong calendar square.
   *
   * Omitting `include` asks for every section.
   */
  stats: (params: {
    from?: string
    to?: string
    include?: ('daily' | 'muscles' | 'streak')[]
  } = {}) =>
    api.get<{ data: types.TrainingStats }>('/workouts/stats', {
      params: {
        from: params.from,
        to: params.to,
        include: params.include?.join(','),
        tz_offset: -new Date().getTimezoneOffset(),
      },
    }).then(res => unwrap(res)),
  /** Each exercise's current best set, most recently achieved first. */
  prs: (limit = 20) =>
    api.get<{ data: types.RecentPR[] }>('/workouts/prs', { params: { limit } }).then(res => unwrap(res)),
}

let _exerciseCache: types.Exercise[] | null = null
let _exerciseCachePromise: Promise<types.Exercise[]> | null = null

let _facetCache: types.ExerciseFacets | null = null

export const exerciseAPI = {
  list: (params?: types.ExerciseQuery) => {
    if (params && Object.values(params).some(Boolean)) {
      return api.get<{ data: types.Exercise[] }>('/exercises', { params }).then(res => unwrap(res))
    }
    if (_exerciseCache) return Promise.resolve(_exerciseCache)
    if (_exerciseCachePromise) return _exerciseCachePromise
    _exerciseCachePromise = api.get<{ data: types.Exercise[] }>('/exercises', { params: { limit: 1000 } })
      .then(res => {
        _exerciseCache = unwrap(res)
        _exerciseCachePromise = null
        return _exerciseCache
      })
    return _exerciseCachePromise
  },
  get: (id: number) => api.get<{ data: types.Exercise }>(`/exercises/${id}`).then(res => unwrap(res)),
  getPRs: (id: number) => api.get<{ data: types.PersonalRecord }>(`/exercises/${id}/prs`).then(res => unwrap(res)),
  getHistory: (id: number, limit = 20) => api.get<{ data: types.ExerciseHistoryPoint[] }>(`/exercises/${id}/history`, { params: { limit } }).then(res => unwrap(res)),
  /**
   * Filter options with counts. The catalog is static reference data and the
   * counts are global (not cross-filtered), so one fetch per session is enough.
   */
  facets: () => {
    if (_facetCache) return Promise.resolve(_facetCache)
    return api.get<{ data: types.ExerciseFacets }>('/exercises/facets')
      .then(res => { _facetCache = unwrap(res); return _facetCache })
  },
  /** Adds a name + body-part-only exercise to the shared catalog, then busts
   *  the list/facet caches so it shows up immediately. */
  create: (input: { name: string; muscle_group: string; equipment?: string }) =>
    api.post<{ data: types.Exercise }>('/exercises', input).then(res => unwrap(res)).then(ex => {
      exerciseAPI.clearCache()
      return ex
    }),
  clearCache: () => { _exerciseCache = null; _exerciseCachePromise = null; _facetCache = null },
  seedStatus: () => api.get<{ data: { count: number; in_progress: boolean } }>('/admin/seed-status').then(res => unwrap(res)),
  sync: () => api.post<{ data: { synced: boolean; total: number } }>('/admin/sync-exercises').then(res => unwrap(res)),
}

export const exerciseMigrationAPI = {
  status: () => api.get<{ data: types.ExerciseMigrationStatus }>('/admin/exercise-migration/status').then(res => unwrap(res)),
  preview: (toSource: string) =>
    api.post<{ data: types.ExerciseMigration }>('/admin/exercise-migration/preview', { to_source: toSource }).then(res => unwrap(res)),
  confirm: (id: number, mapping: types.ExerciseMigrationMappingEntry[]) =>
    api.post<{ data: types.ExerciseMigrationResult }>(`/admin/exercise-migration/${id}/confirm`, { mapping }).then(res => unwrap(res)),
}


const tzOffset = () => -new Date().getTimezoneOffset()

export const scheduleAPI = {
  /** Resolved plan for a date range, plus the recurring pattern behind it. */
  range: (from: string, to: string) =>
    api.get<{ data: types.ScheduleResponse }>('/schedule', { params: { from, to, tz_offset: tzOffset() } })
      .then(res => unwrap(res)),
  today: () =>
    api.get<{ data: types.ScheduledDay | null }>('/schedule/today', { params: { tz_offset: tzOffset() } })
      .then(res => unwrap(res)),
  /** Full replace of the weekly pattern; keys are weekday numbers as strings. */
  replace: (days: Record<string, number[]>) =>
    api.put<{ data: { recurring: types.RecurringSchedule } }>('/schedule', { days }).then(res => unwrap(res)),
  /** Change one date without touching the pattern. An empty list = rest day. */
  setOverride: (date: string, programIds: number[]) =>
    api.post<{ data: types.ScheduledDay }>('/schedule/overrides', { date, program_ids: programIds })
      .then(res => unwrap(res)),
  clearOverride: (date: string) =>
    api.delete<{ data: types.ScheduledDay }>(`/schedule/overrides/${date}`).then(res => unwrap(res)),
}

export const programAPI = {
  list:       (params?: { limit?: number; offset?: number; q?: string; sort?: types.ProgramSort }) => api.get<{ data: types.Program[] }>('/programs', { params }).then(res => unwrap(res)),
  listShared: (params?: { limit?: number; offset?: number; q?: string; sort?: types.ProgramSort }) => api.get<{ data: types.Program[] }>('/programs/shared', { params }).then(res => unwrap(res)),
  get:    (id: number) => api.get<{ data: types.Program }>(`/programs/${id}`).then(res => unwrap(res)),
  create: (data: any) => api.post<{ data: types.Program }>('/programs', data).then(res => unwrap(res)),
  update: (id: number, data: any) => api.put<{ data: types.Program }>(`/programs/${id}`, data).then(res => unwrap(res)),
  delete: (id: number) => api.delete(`/programs/${id}`),
  share:   (id: number) => api.post<{ data: types.Program }>(`/programs/${id}/share`).then(res => unwrap(res)),
  unshare: (id: number) => api.post<{ data: types.Program }>(`/programs/${id}/unshare`).then(res => unwrap(res)),
  copy:    (id: number) => api.post<{ data: types.Program }>(`/programs/${id}/copy`).then(res => unwrap(res)),
  generate: (data: { goals: string; focus_areas?: string; equipment?: string; time_period?: string; number_of_days: number }) =>
    api.post<{ data: { programs: types.DraftProgram[] } }>('/programs/generate', data).then(res => unwrap(res)),
}

export const weightAPI = {
  list:   (params?: { limit?: number; offset?: number; from?: string; to?: string }) =>
    api.get<{ data: types.WeightLog[] }>('/weight', { params }).then(res => unwrap(res)),
  get:    (id: number) => api.get<{ data: types.WeightLog }>(`/weight/${id}`).then(res => unwrap(res)),
  log:    (data: { weight: number; notes?: string; logged_at?: string }) =>
    api.post<{ data: types.WeightLog }>('/weight', data).then(res => unwrap(res)),
  update: (id: number, data: { weight: number; notes?: string; logged_at?: string }) =>
    api.patch<{ data: types.WeightLog }>(`/weight/${id}`, data).then(res => unwrap(res)),
  delete: (id: number) => api.delete(`/weight/${id}`),
  stats:  () => api.get<{ data: types.WeightStats }>('/weight/stats').then(res => unwrap(res)),
}

// Blood pressure (#bloodPressure). No unit conversion anywhere: mmHg is
// universal, so unlike weight there is no display/storage split to bridge.
export const bloodPressureAPI = {
  list:   (params?: { limit?: number; offset?: number; from?: string; to?: string }) =>
    api.get<{ data: types.BloodPressureLog[] }>('/blood-pressure', { params }).then(res => unwrap(res)),
  get:    (id: number) => api.get<{ data: types.BloodPressureLog }>(`/blood-pressure/${id}`).then(res => unwrap(res)),
  log:    (data: types.LogBloodPressureRequest) =>
    api.post<{ data: types.BloodPressureLog }>('/blood-pressure', data).then(res => unwrap(res)),
  update: (id: number, data: types.LogBloodPressureRequest) =>
    api.patch<{ data: types.BloodPressureLog }>(`/blood-pressure/${id}`, data).then(res => unwrap(res)),
  delete: (id: number) => api.delete(`/blood-pressure/${id}`),
  stats:  () => api.get<{ data: types.BPStats }>('/blood-pressure/stats').then(res => unwrap(res)),
  // Reading never spends an AI call; resolves null when none has been run yet.
  insight: () => api.get<{ data: types.BPInsight }>('/blood-pressure/insight')
    .then(res => unwrap(res))
    .catch(err => { if (err?.response?.status === 404) return null; throw err }),
  runInsight: () => api.post<{ data: types.BPInsight }>('/blood-pressure/insight').then(res => unwrap(res)),
}

export const healthAPI = {
  summary: () => api.get<{ data: types.MetricSummary[] }>('/health/summary').then(res => unwrap(res)),
}

export const profileAPI = {
  get:    () => api.get<{ data: types.ProfileWithBMI }>('/profile').then(res => unwrap(res)),
  update: (data: Partial<types.UserProfile>) => api.put<{ data: types.UserProfile }>('/profile', data).then(res => unwrap(res)),
}

export const weightPlanAPI = {
  generate: (data: { target_weight: number; timeframe_weeks?: number }) =>
    api.post<{ data: types.DraftWeightPlan }>('/weight/plan/generate', data).then(res => unwrap(res)),
  accept: (data: {
    calorie_target: number; protein_target: number; carb_target: number; fat_target: number
    target_weight: number; notes?: string; weekly_trajectory: types.WeightPlanProjectionPoint[]
    plan_detail?: types.PlanDetail
  }) => api.post<{ data: types.NutritionGoal }>('/weight/plan/accept', data).then(res => unwrap(res)),
  current: () => api.get<{ data: types.CurrentNutritionGoal }>('/weight/plan/current').then(res => unwrap(res)),
  history: () => api.get<{ data: types.NutritionGoal[] }>('/weight/plan/goals').then(res => unwrap(res)),
  adherence: (refresh?: boolean) =>
    api.get<{ data: types.WeightPlanAdherence }>('/weight/plan/adherence', { params: refresh ? { refresh: 1 } : undefined }).then(res => unwrap(res)),
  // Named `progress`, not `history` — `history` above is the goal *list*.
  // Omit `from` to use the user's remembered plan_history_start.
  progress: (from?: string) =>
    api.get<{ data: types.WeightPlanHistory }>('/weight/plan/history', { params: from ? { from } : undefined }).then(res => unwrap(res)),
  // Progress check-in. `checkin()` only reads the last stored run and resolves
  // null when there isn't one — reading never spends an AI call. `runCheckin()`
  // is the explicit generate, and is slow (up to ~60s).
  checkin: () =>
    api.get<{ data: types.PlanCheckin }>('/weight/plan/checkin')
      .then(res => unwrap(res))
      .catch(err => {
        if (err?.response?.status === 404) return null
        throw err
      }),
  runCheckin: () =>
    api.post<{ data: types.PlanCheckin }>('/weight/plan/checkin').then(res => unwrap(res)),
}

export const foodAPI = {
  list:    (date?: string) => api.get<{ data: types.FoodLog[] }>('/food', { params: { date } }).then(res => unwrap(res)),
  log:     (data: any) => api.post<{ data: types.FoodLog }>('/food', data).then(res => unwrap(res)),
  get:     (id: number) => api.get<{ data: types.FoodLog }>(`/food/${id}`).then(res => unwrap(res)),
  update:  (id: number, data: any) => api.patch<{ data: types.FoodLog }>(`/food/${id}`, data).then(res => unwrap(res)),
  delete:  (id: number) => api.delete(`/food/${id}`),
  stats:   (date?: string) => api.get<{ data: types.DailyStats }>('/food/stats', { params: { date } }).then(res => unwrap(res)),
  // Copies a logged entry (any day) into My Foods, normalised to one serving.
  // Without `overwrite` a name/brand/barcode match rejects with 409 and the
  // existing saved food in `err.response.data.data`, so the caller can offer to
  // refresh it instead of creating a near-duplicate.
  saveToMyFoods: (id: number, overwrite = false) =>
    api.post<{ data: types.SavedFood }>(`/food/${id}/save`, null, { params: overwrite ? { overwrite: 'true' } : undefined })
      .then(res => unwrap(res)),
  history: (days = 30) => api.get<{ data: types.FoodHistoryPoint[] }>('/food/history', { params: { days } }).then(res => unwrap(res)),
  recent:  () => api.get<{ data: types.RecentFood[] }>('/food/recent').then(res => unwrap(res)),
  // `sources` narrows which upstream databases are queried ('off' | 'fdc').
  // Omitted means all of them — the backend treats an absent value as "no
  // restriction", so callers that don't care can ignore it entirely.
  search:  (q: string, limit = 20, sources?: types.FoodSource[]) =>
    api.get<{ data: types.FoodSearchResult[] }>('/food/search', {
      params: { q, limit, ...(sources?.length ? { sources: sources.join(',') } : {}) },
    }).then(res => unwrap(res)),
  barcode: (code: string) => api.get<{ data: types.FoodSearchResult }>(`/food/barcode/${code}`).then(res => unwrap(res)),
  analyzeLabel: (imageBase64: string, mediaType: string) =>
    api.post<{ data: types.NutritionExtraction }>('/food/analyze-label', { image_base64: imageBase64, media_type: mediaType }).then(res => unwrap(res)),
  parseMeal: (description: string) =>
    api.post<{ data: { items: types.MealItem[] } }>('/food/parse-meal', { description }).then(res => unwrap(res)),
  analyzeMealPhoto: (imageBase64: string, mediaType: string, description?: string) =>
    api.post<{ data: types.MealPhotoAnalysis }>('/food/analyze-meal-photo', {
      image_base64: imageBase64, media_type: mediaType, description: description ?? '',
    }).then(res => unwrap(res)),
  recommend: (meal: string, date: string) =>
    api.post<{ data: { recommendations: types.MealRecommendation[] } }>('/food/recommend', { meal, date }).then(res => unwrap(res)),
}

export const savedFoodsAPI = {
  list:   () => api.get<{ data: types.SavedFood[] }>('/food/saved').then(res => unwrap(res)),
  create: (data: any) => api.post<{ data: types.SavedFood }>('/food/saved', data).then(res => unwrap(res)),
  get:    (id: number) => api.get<{ data: types.SavedFood }>(`/food/saved/${id}`).then(res => unwrap(res)),
  update: (id: number, data: any) => api.put<{ data: types.SavedFood }>(`/food/saved/${id}`, data).then(res => unwrap(res)),
  delete: (id: number) => api.delete(`/food/saved/${id}`),
}

export interface PersonalAccessToken {
  id: number
  name: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

export const tokenAPI = {
  list: () => api.get<{ data: PersonalAccessToken[] }>('/tokens').then(res => unwrap(res)),
  create: (name: string, expiresInDays: number | null) =>
    api.post<{ data: { token: PersonalAccessToken; value: string } }>('/tokens', {
      name, expires_in_days: expiresInDays,
    }).then(res => unwrap(res)),
  revoke: (id: number) => api.delete(`/tokens/${id}`),
}

export interface Passkey {
  id: number
  name: string
  created_at: string
  last_used_at: string | null
}

// The two-step ceremonies. `begin` returns the options the browser needs;
// `finish` posts the authenticator's response verbatim, which is why the
// passkey name and challenge id travel as query parameters rather than in a
// wrapper object — the server hands the body straight to its WebAuthn library.
export const passkeyAPI = {
  list:   () => api.get<{ data: Passkey[] }>('/passkeys').then(res => unwrap(res)),
  delete: (id: number) => api.delete(`/passkeys/${id}`),

  registerBegin: () =>
    api.post<{ data: { publicKey: any } }>('/passkeys/register/begin').then(res => unwrap(res)),
  registerFinish: (name: string, attestation: unknown) =>
    api.post(`/passkeys/register/finish?name=${encodeURIComponent(name)}`, attestation),

  loginBegin: () =>
    api.post<{ data: { publicKey: any; challenge_id: string } }>('/auth/webauthn/login/begin').then(res => unwrap(res)),
  loginFinish: (challengeID: string, assertion: unknown) =>
    api.post<{ data: types.AuthResponse }>(
      `/auth/webauthn/login/finish?challenge_id=${encodeURIComponent(challengeID)}`, assertion,
    ).then(res => unwrap(res)),
}

// One signed-in device. The id is a revocation handle, not a credential —
// there is no token material here.
export interface DeviceSession {
  id: string
  label: string
  user_agent: string
  remembered: boolean
  created_at: string
  last_seen_at: string
  expires_at: string
  /** The session making the request, so the UI can warn before signing itself out. */
  current: boolean
}

export const sessionAPI = {
  list: () => api.get<{ data: DeviceSession[] }>('/sessions').then(res => unwrap(res)),
  revoke: (id: string) => api.delete(`/sessions/${id}`),
}

export const activeSessionAPI = {
  get: () => api.get<{ data: { data: string | null; updated_at?: string } | null }>('/active-session').then(res => unwrap(res)),
  put: (data: types.ActiveSession) => api.put('/active-session', { data: JSON.stringify(data) }),
  delete: () => api.delete('/active-session'),
}

export default api
