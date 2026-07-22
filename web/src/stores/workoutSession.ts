import { create } from 'zustand'
import * as types from '../types'
import { programAPI, activeSessionAPI } from '../services/api'

const SESSION_KEY = 'lyftr_active_session'
const SESSION_UPDATED_KEY = 'lyftr_active_session_updated_at'
const GYM_UI_KEY = 'lyftr_gym_ui'

function saveLocal(session: types.ActiveSession | null) {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    localStorage.setItem(SESSION_UPDATED_KEY, String(Date.now()))
  } else {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SESSION_UPDATED_KEY)
  }
}

function loadLocal(): types.ActiveSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

type GymPhase = 'overview' | 'exercise-info' | 'exercise'

type GymUiState = { phase: GymPhase; exIdx: number; setIdx: number }

function saveGymUi(s: GymUiState) {
  localStorage.setItem(GYM_UI_KEY, JSON.stringify(s))
}

function loadGymUi(): GymUiState {
  try {
    const raw = localStorage.getItem(GYM_UI_KEY)
    return raw ? JSON.parse(raw) : { phase: 'overview', exIdx: 0, setIdx: 0 }
  } catch {
    return { phase: 'overview', exIdx: 0, setIdx: 0 }
  }
}

interface WorkoutSessionStore {
  session: types.ActiveSession | null
  gymOpen: boolean
  gymPhase: GymPhase
  gymExIdx: number
  gymSetIdx: number
  startSession: (name: string, exercises: types.ActiveSessionExercise[], programId?: number) => void
  updateSet: (exIdx: number, setIdx: number, field: 'actual_reps' | 'actual_weight', val: number) => void
  completeSet: (exIdx: number, setIdx: number) => void
  updateExerciseNotes: (exIdx: number, notes: string) => void
  addSet: (exIdx: number) => void
  removeSet: (exIdx: number, setIdx: number) => void
  addExercise: (ex: types.ActiveSessionExercise) => void
  removeExercise: (exIdx: number) => void
  buildPayload: () => any
  cancelSession: () => void
  // Set when a poll finds the server's active session gone while this tab
  // still has one locally (e.g. ended from a paired watch/phone or another
  // tab) — holds the ended session's started_at so a listener (Layout) can
  // look up the resulting workout and navigate to its summary.
  endedRemotely: string | null
  clearEndedRemotely: () => void
  openGym: () => void
  minimizeGym: () => void
  setGymState: (phase: GymPhase, exIdx: number, setIdx: number) => void
  setExerciseRest: (exIdx: number, secs: number) => void
  // Rest timer — ephemeral (never persisted). Survives minimize/restore via the
  // module singleton; evaporates on full refresh by design (an absolute timestamp
  // must not outlive the session moment).
  restEndsAt: number | null
  restDurationSec: number | null
  restExIdx: number | null
  restSetIdx: number | null
  // When paused, restEndsAt is nulled and the frozen remaining time is parked here
  // (ms). This is the single "paused" flag: paused iff restPausedRemainingMs != null.
  restPausedRemainingMs: number | null
  startRest: (durationSec: number, exIdx: number, setIdx: number) => void
  adjustRest: (deltaSec: number) => void
  pauseRest: () => void
  resumeRest: () => void
  clearRest: () => void
}

// Pushes the full session (+ current position + rest timer) to the server so
// other devices — notably a Wear OS watch via the Android companion app —
// can pick up mid-workout state. Debounced since most mutations (typing a
// weight, nudging rest by a few seconds) fire in quick bursts.
let _syncTimer: ReturnType<typeof setTimeout> | null = null
// Serialized form of the last session this tab pushed (or adopted from the
// server). Lets the poll in hydrateActiveSessionFromServer tell "our own
// echo coming back" apart from a genuinely foreign update (e.g. a set
// completed on the watch) — the server's updated_at alone can't, since a
// debounced PUT lands after the local edit that produced it.
let _lastSyncedJson: string | null = null

function scheduleSync(immediate = false) {
  if (_syncTimer) {
    clearTimeout(_syncTimer)
    _syncTimer = null
  }
  const flush = () => {
    _syncTimer = null
    const state = useWorkoutSession.getState()
    if (!state.session) return
    const payload: types.ActiveSession = {
      ...state.session,
      current_exercise_idx: state.gymExIdx,
      current_set_idx: state.gymSetIdx,
      rest_ends_at: state.restEndsAt,
      rest_duration_sec: state.restDurationSec,
    }
    const json = JSON.stringify(payload)
    activeSessionAPI.put(payload).then(() => {
      _lastSyncedJson = json
    }).catch(() => {
      // offline/unreachable — local state (source of truth for this device)
      // is unaffected; the next scheduled sync will retry.
    })
  }
  if (immediate) flush()
  else _syncTimer = setTimeout(flush, 1500)
}

const _savedGymUi = loadGymUi()

// All rest-timer fields nulled — the single "no active rest" state, reused wherever
// rest is cleared (clearRest, cancelSession, and structural edits that invalidate the
// positional restExIdx/restSetIdx).
const CLEARED_REST = {
  restEndsAt: null, restDurationSec: null, restExIdx: null, restSetIdx: null, restPausedRemainingMs: null,
} as const

export const useWorkoutSession = create<WorkoutSessionStore>((set, get) => ({
  session: loadLocal(),
  gymOpen: false,
  gymPhase: _savedGymUi.phase,
  gymExIdx: _savedGymUi.exIdx,
  gymSetIdx: _savedGymUi.setIdx,
  ...CLEARED_REST,
  endedRemotely: null,
  clearEndedRemotely: () => set({ endedRemotely: null }),

  startRest: (durationSec, exIdx, setIdx) => {
    set({ restEndsAt: Date.now() + durationSec * 1000, restDurationSec: durationSec, restExIdx: exIdx, restSetIdx: setIdx, restPausedRemainingMs: null })
    scheduleSync()
  },
  adjustRest: (deltaSec) => {
    set(state => {
      const nextDuration = Math.max(1, (state.restDurationSec ?? 0) + deltaSec)
      // Adjusting while paused shifts the parked remaining time, not a live end stamp.
      if (state.restPausedRemainingMs != null) {
        const nextMs = state.restPausedRemainingMs + deltaSec * 1000
        // Adjusted to zero while paused → finish it: unpause into the completed
        // state (restEndsAt = now → countdown reads 0 → done → auto-dismiss), so it
        // never sticks at "0:00 · paused" with no completion path.
        if (nextMs <= 0) return { restPausedRemainingMs: null, restEndsAt: Date.now(), restDurationSec: nextDuration }
        return { restPausedRemainingMs: nextMs, restDurationSec: nextDuration }
      }
      if (state.restEndsAt == null) return {}
      return {
        restEndsAt: Math.max(Date.now(), state.restEndsAt + deltaSec * 1000),
        restDurationSec: nextDuration,
      }
    })
    scheduleSync()
  },
  // Freeze the countdown: park the remaining time and null the live end stamp so
  // useCountdown (here and in the minimized-gym mount) stops ticking.
  pauseRest: () => {
    set(state => {
      if (state.restEndsAt == null || state.restPausedRemainingMs != null) return {}
      return { restPausedRemainingMs: Math.max(0, state.restEndsAt - Date.now()), restEndsAt: null }
    })
    scheduleSync()
  },
  resumeRest: () => {
    set(state => {
      if (state.restPausedRemainingMs == null) return {}
      return { restEndsAt: Date.now() + state.restPausedRemainingMs, restPausedRemainingMs: null }
    })
    scheduleSync()
  },
  clearRest: () => {
    set({ ...CLEARED_REST })
    scheduleSync()
  },

  openGym: () => set({ gymOpen: true }),
  minimizeGym: () => set({ gymOpen: false }),
  setGymState: (gymPhase, gymExIdx, gymSetIdx) => {
    saveGymUi({ phase: gymPhase, exIdx: gymExIdx, setIdx: gymSetIdx })
    set({ gymPhase, gymExIdx, gymSetIdx })
    scheduleSync()
  },

  startSession: (name, exercises, programId) => {
    const session: types.ActiveSession = {
      name,
      started_at: new Date().toISOString(),
      exercises,
      program_id: programId,
    }
    saveLocal(session)
    set({ session })
    scheduleSync(true)
  },

  updateSet: (exIdx, setIdx, field, val) => {
    const session = get().session
    if (!session) return
    const exercises = session.exercises.map((ex, i) => {
      if (i !== exIdx) return ex
      const oldVal = ex.sets[setIdx][field]
      let sets = ex.sets.map((s, j) => j === setIdx ? { ...s, [field]: val } : s)
      // Predictive propagation: shifting a set's actual weight (up or down)
      // carries the same delta forward onto later, not-yet-completed sets —
      // this both fills in blank future sets (delta === new value when the
      // edited set was 0) and preserves a pyramid's relative step size.
      if (field === 'actual_weight') {
        const delta = val - oldVal
        if (delta !== 0) {
          sets = sets.map((s, j) =>
            j > setIdx && !s.completed
              ? { ...s, actual_weight: Math.max(0, s.actual_weight + delta) }
              : s
          )
        }
      }
      return { ...ex, sets }
    })
    const updated = { ...session, exercises }
    saveLocal(updated)
    set({ session: updated })
    scheduleSync()
  },

  completeSet: (exIdx, setIdx) => {
    const session = get().session
    if (!session) return
    const exercises = session.exercises.map((ex, i) =>
      i !== exIdx ? ex : {
        ...ex,
        sets: ex.sets.map((s, j) => j === setIdx ? { ...s, completed: !s.completed } : s),
      }
    )
    const updated = { ...session, exercises }
    saveLocal(updated)
    set({ session: updated })
    scheduleSync(true)
  },

  updateExerciseNotes: (exIdx, notes) => {
    const session = get().session
    if (!session) return
    const exercises = session.exercises.map((ex, i) => i !== exIdx ? ex : { ...ex, notes })
    const updated = { ...session, exercises }
    saveLocal(updated)
    set({ session: updated })
    scheduleSync()
  },

  setExerciseRest: (exIdx, secs) => {
    const session = get().session
    if (!session) return
    const exercises = session.exercises.map((ex, i) => i !== exIdx ? ex : { ...ex, rest_seconds: secs })
    const updated = { ...session, exercises }
    saveLocal(updated)
    set({ session: updated })
    scheduleSync()
  },

  addSet: (exIdx) => {
    const session = get().session
    if (!session) return
    const exercises = session.exercises.map((ex, i) => {
      if (i !== exIdx) return ex
      const last = ex.sets[ex.sets.length - 1]
      return {
        ...ex,
        sets: [...ex.sets, {
          set_number: ex.sets.length + 1,
          target_reps: last?.target_reps ?? 0,
          target_weight: last?.target_weight ?? 0,
          actual_reps: last?.actual_reps ?? 0,
          actual_weight: last?.actual_weight ?? 0,
          completed: false,
        }],
      }
    })
    const updated = { ...session, exercises }
    saveLocal(updated)
    set({ session: updated })
    scheduleSync()
  },

  removeSet: (exIdx, setIdx) => {
    const session = get().session
    if (!session) return
    const exercises = session.exercises.map((ex, i) => {
      if (i !== exIdx) return ex
      const newSets = ex.sets
        .filter((_, j) => j !== setIdx)
        .map((s, j) => ({ ...s, set_number: j + 1 }))
      return { ...ex, sets: newSets }
    })
    const updated = { ...session, exercises }
    saveLocal(updated)
    // Removing a set shifts set indices, invalidating the positional restSetIdx — cancel
    // the (ephemeral) rest rather than let it point at the wrong set.
    set({ session: updated, ...CLEARED_REST })
    scheduleSync()
  },

  addExercise: (ex) => {
    const session = get().session
    if (!session) return
    const updated = { ...session, exercises: [...session.exercises, ex] }
    saveLocal(updated)
    set({ session: updated })
    scheduleSync()
  },

  removeExercise: (exIdx) => {
    const session = get().session
    if (!session) return
    const updated = { ...session, exercises: session.exercises.filter((_, i) => i !== exIdx) }
    saveLocal(updated)
    // filter() shifts exercise indices, invalidating the positional restExIdx — cancel
    // the (ephemeral) rest so it can't collapse controls on the wrong exercise.
    set({ session: updated, ...CLEARED_REST })
    scheduleSync()
  },

  buildPayload: () => {
    const session = get().session
    if (!session) return null
    const durationSec = Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000)
    return {
      name: session.name,
      notes: '',
      duration: durationSec,
      started_at: session.started_at,
      program_id: session.program_id,
      exercises: session.exercises.map(ex => ({
        exercise_id: ex.exercise_id,
        notes: ex.notes,
        rest_seconds: ex.rest_seconds,
        sets: ex.sets.map((s, i) => ({
          set_number: i + 1,
          reps: s.actual_reps || s.target_reps,
          weight: s.actual_weight || s.target_weight,
          completed: s.completed,
        })),
      })),
    }
  },

  cancelSession: () => {
    if (_syncTimer) {
      clearTimeout(_syncTimer)
      _syncTimer = null
    }
    saveLocal(null)
    localStorage.removeItem(GYM_UI_KEY)
    set({
      session: null, gymOpen: false, gymPhase: 'overview', gymExIdx: 0, gymSetIdx: 0,
      ...CLEARED_REST,
    })
    // Covers both "finished" and "discarded" — either way nothing should be
    // left mid-workout on the server for a watch/other device to pick up.
    activeSessionAPI.delete().catch(() => {})
  },
}))

// Pulls the server's saved session (if any) and adopts it when it's newer
// than what's stored locally — the path that lets a workout started on
// another device (web, or the Android companion app relaying a watch) show
// up here. Called on app load/login and then on an interval (see
// startActiveSessionPolling) so watch-side edits appear without a reload;
// safe to call when logged out or offline, in which case the local session
// (if any) is left untouched.
export async function hydrateActiveSessionFromServer() {
  try {
    const result = await activeSessionAPI.get()
    if (!result?.data) {
      // Server has no session, but this tab still thinks one is running —
      // it was ended elsewhere (a paired watch/phone, or another tab).
      // Tear down local state and leave a breadcrumb so a listener can
      // navigate to the resulting workout's summary.
      const localSession = useWorkoutSession.getState().session
      if (localSession) {
        clearLocalSession()
        useWorkoutSession.setState({ endedRemotely: localSession.started_at })
      }
      return
    }
    // Server holds exactly what this tab last pushed (or adopted) — our own
    // echo, nothing foreign to pull and nothing missing to push.
    if (result.data === _lastSyncedJson) return
    const remote: types.ActiveSession = JSON.parse(result.data)
    const remoteUpdatedMs = result.updated_at ? new Date(result.updated_at).getTime() : 0
    const localUpdatedMs = Number(localStorage.getItem(SESSION_UPDATED_KEY) ?? 0)
    const state = useWorkoutSession.getState()

    if (!state.session || remoteUpdatedMs > localUpdatedMs) {
      // A queued debounced push holds pre-adoption state — cancel it or it
      // would overwrite the newer remote session we're about to take.
      if (_syncTimer) {
        clearTimeout(_syncTimer)
        _syncTimer = null
      }
      const exIdx = remote.current_exercise_idx ?? 0
      const setIdx = remote.current_set_idx ?? 0
      saveLocal(remote)
      saveGymUi({ phase: state.gymPhase, exIdx, setIdx })
      useWorkoutSession.setState({
        session: remote,
        gymExIdx: exIdx,
        gymSetIdx: setIdx,
        restEndsAt: remote.rest_ends_at ?? null,
        restDurationSec: remote.rest_duration_sec ?? null,
        restExIdx: remote.rest_ends_at != null ? exIdx : null,
        restSetIdx: remote.rest_ends_at != null ? setIdx : null,
        restPausedRemainingMs: null,
      })
      _lastSyncedJson = result.data
    } else if (state.session) {
      // Local is newer (e.g. offline edits) — push it up so the server
      // (and any watch/phone reading from it) catches up.
      scheduleSync(true)
    }
  } catch {
    // Logged out, offline, or server doesn't support this yet — keep
    // whatever local session exists and don't block app startup on it.
  }
}

// Clears this device's copy of the active session (localStorage + store)
// WITHOUT deleting it on the server — used on logout, where the workout may
// legitimately still be running on another device or account session. The
// next login on this browser starts from whatever the server holds.
export function clearLocalSession() {
  if (_syncTimer) {
    clearTimeout(_syncTimer)
    _syncTimer = null
  }
  _lastSyncedJson = null
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(SESSION_UPDATED_KEY)
  localStorage.removeItem(GYM_UI_KEY)
  useWorkoutSession.setState({
    session: null, gymOpen: false, gymPhase: 'overview', gymExIdx: 0, gymSetIdx: 0,
    ...CLEARED_REST,
  })
}

// Poll cadences: 8s during an active workout roughly matches the phone
// companion's own loop (watch action → phone PUT → here); 45s with no
// session is only there so a workout started on the watch/phone eventually
// shows up in an already-open tab. A hidden tab doesn't poll at all — the
// visibilitychange/focus listeners hydrate once on return instead.
const ACTIVE_POLL_MS = 8000
const IDLE_POLL_MS = 45000

// Keeps this tab following watch/phone-side edits while logged in. Returns
// a cleanup function for the caller's useEffect.
export function startActiveSessionPolling(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let lastHydrate = 0

  const scheduleNext = () => {
    if (stopped || document.hidden) return
    const delay = useWorkoutSession.getState().session ? ACTIVE_POLL_MS : IDLE_POLL_MS
    timer = setTimeout(async () => {
      lastHydrate = Date.now()
      await hydrateActiveSessionFromServer()
      scheduleNext()
    }, delay)
  }

  const onVisible = () => {
    if (document.hidden) {
      // Stop polling entirely while hidden — nothing on a background tab
      // needs fresh session data.
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      return
    }
    // Back in view: catch up immediately, then resume the timer chain.
    // visibilitychange and focus both fire on tab return — the timestamp
    // guard collapses them into one fetch.
    if (timer) clearTimeout(timer)
    timer = null
    if (Date.now() - lastHydrate < 2000) {
      scheduleNext()
      return
    }
    lastHydrate = Date.now()
    hydrateActiveSessionFromServer().finally(scheduleNext)
  }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  scheduleNext()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
  }
}

// Best-effort: writes the weights actually logged in a finished workout back
// onto the Program it came from (matched by exercise_id + set_number), so the
// next time the program is started it seeds from the updated numbers. Only
// touches target_weight — structure (notes, rest, order, untouched sets)
// comes straight from the fetched program. Swallows errors since the workout
// itself has already saved successfully by the time this runs.
export async function syncProgramWeights(session: types.ActiveSession) {
  if (!session.program_id) return
  try {
    const program = await programAPI.get(session.program_id)
    const usedExIdx = new Set<number>()
    const exercises = program.exercises.map(pex => {
      const sessionEx = session.exercises.find((se, i) =>
        se.exercise_id === pex.exercise_id && !usedExIdx.has(i) && usedExIdx.add(i)
      )
      return {
        exercise_id: pex.exercise_id,
        notes: pex.notes,
        rest_seconds: pex.rest_seconds,
        sets: pex.sets.map(pset => {
          const sessionSet = sessionEx?.sets.find(s => s.set_number === pset.set_number)
          const weight = sessionSet && sessionSet.actual_weight > 0 ? sessionSet.actual_weight : pset.target_weight
          return { set_number: pset.set_number, target_reps: pset.target_reps, target_weight: weight }
        }),
      }
    })
    await programAPI.update(program.id, { name: program.name, notes: program.notes, exercises })
  } catch {
    // no-op — see comment above
  }
}
