import { create } from 'zustand'
import * as types from '../types'
import { userAPI } from '../services/api'

const LAYOUT_KEY = 'lyftr_workout_layout'
const REST_ON_KEY = 'lyftr_rest_enabled'
const REST_SEC_KEY = 'lyftr_rest_seconds'

// Client-only prefs (not stored server-side) — re-applied over any backend fetch
// so a settings GET/PUT never clobbers them.
function clientPrefs(): Pick<types.UserSettings, 'workout_layout' | 'rest_enabled' | 'rest_seconds_default'> {
  return {
    workout_layout: (localStorage.getItem(LAYOUT_KEY) as 'list' | 'gym') ?? 'list',
    rest_enabled: localStorage.getItem(REST_ON_KEY) !== 'false', // default on
    rest_seconds_default: Number(localStorage.getItem(REST_SEC_KEY)) || 90,
  }
}

interface SettingsStore {
  settings: types.UserSettings
  loaded: boolean
  fetch: () => Promise<void>
  update: (patch: Partial<types.UserSettings>) => Promise<void>
  setWorkoutLayout: (layout: 'list' | 'gym') => void
  setRestEnabled: (on: boolean) => void
  setRestSeconds: (secs: number) => void
  reset: () => void
}

const DEFAULTS: types.UserSettings = {
  user_id: 0,
  weight_unit: 'lbs',
  calorie_target: 2000,
  protein_target: 150,
  carb_target: 250,
  fat_target: 65,
  cholesterol_target: 300,
  sodium_target: 2300,
  food_allergies: '',
  food_dislikes: '',
  food_likes: '',
  ...clientPrefs(),
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,

  fetch: async () => {
    if (get().loaded) return
    try {
      const s = await userAPI.getSettings()
      set({ settings: { ...s, ...clientPrefs() }, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  update: async (patch) => {
    set(state => ({ settings: { ...state.settings, ...patch } }))
    const updated = await userAPI.updateSettings(patch)
    set({ settings: { ...updated, ...clientPrefs() } })
  },

  setWorkoutLayout: (layout) => {
    localStorage.setItem(LAYOUT_KEY, layout)
    set(state => ({ settings: { ...state.settings, workout_layout: layout } }))
  },

  setRestEnabled: (on) => {
    localStorage.setItem(REST_ON_KEY, String(on))
    set(state => ({ settings: { ...state.settings, rest_enabled: on } }))
  },

  setRestSeconds: (secs) => {
    localStorage.setItem(REST_SEC_KEY, String(secs))
    set(state => ({ settings: { ...state.settings, rest_seconds_default: secs } }))
  },

  reset: () => set({ settings: DEFAULTS, loaded: false }),
}))

export const weightLabel = (unit: string) => unit === 'kg' ? 'kg' : 'lbs'
export const weightShort = (unit: string) => unit === 'kg' ? 'kg' : 'lb'

// Backend always stores lbs. Use these helpers everywhere weight values are read/written.
export const lbsToDisplay = (lbs: number, unit: string): number =>
  unit === 'kg' ? lbs / 2.20462 : lbs

export const displayToLbs = (val: number, unit: string): number =>
  unit === 'kg' ? val * 2.20462 : val

// Round to 0.1. Used for weight display/inputs: enough precision to log exact
// weights (#39) without floating-point noise from the kg conversion.
export const round1 = (n: number): number => Math.round(n * 10) / 10

// Weight in the user's unit, rounded to 0.1 — use everywhere a weight is shown
// or pre-filled into an input (replaces the old Math.round that forced integers).
export const displayWeight = (lbs: number, unit: string): number => round1(lbsToDisplay(lbs, unit))

// Volume/aggregate (sum of reps×weight) in the user's unit, as a whole number.
// Volumes are large and never want 0.1 precision — keep this distinct from
// displayWeight so the two can't be confused.
export const displayVolume = (lbs: number, unit: string): number => Math.round(lbsToDisplay(lbs, unit))

// ── Distance (cardio) ──
// Distance is stored canonically in meters (matches the backend sets.distance
// column and what a Health Connect / Pixel-watch import would populate). The
// display unit follows the weight-unit preference: lbs → miles, kg → km — no
// separate setting. Use these everywhere a cardio distance is read/written.
const METERS_PER_MILE = 1609.344

export const distanceShort = (unit: string) => unit === 'kg' ? 'km' : 'mi'

export const metersToDisplay = (meters: number, unit: string): number =>
  unit === 'kg' ? meters / 1000 : meters / METERS_PER_MILE

export const displayToMeters = (val: number, unit: string): number =>
  unit === 'kg' ? val * 1000 : val * METERS_PER_MILE

// Distance shown to 0.01 (e.g. 3.10 mi) — finer than weight since a run is
// rarely a round number and pace is sensitive to the last tenth.
export const round2 = (n: number): number => Math.round(n * 100) / 100
export const displayDistance = (meters: number, unit: string): number => round2(metersToDisplay(meters, unit))

// Pace ("m:ss /mi" or "/km") from seconds + meters, or '' when either is missing.
// The canonical readout for a logged cardio effort.
export const paceLabel = (seconds: number, meters: number, unit: string): string => {
  const dist = metersToDisplay(meters, unit)
  if (!seconds || dist <= 0) return ''
  const secPerUnit = Math.round(seconds / dist)
  const m = Math.floor(secPerUnit / 60)
  return `${m}:${String(secPerUnit % 60).padStart(2, '0')} /${distanceShort(unit)}`
}

// Bodyweight bounds — mirror the backend (LogWeightRequest: gt=0, lte=2000 lbs)
// so the user gets instant feedback instead of a round-trip 400. Defined once
// here; the weight-logging forms validate through weightError/isValidWeight.
export const MAX_WEIGHT_LBS = 2000

// The max in the user's display unit (2000 lb ≈ 907 kg).
export const maxWeight = (unit: string): number => round1(lbsToDisplay(MAX_WEIGHT_LBS, unit))

// `value` is in the user's display unit. Returns an error message, or null if valid.
export const weightError = (value: number, unit: string): string | null => {
  if (!Number.isFinite(value) || value <= 0) return 'Enter a valid weight'
  if (displayToLbs(value, unit) > MAX_WEIGHT_LBS) {
    return `Weight must be under ${Math.round(maxWeight(unit))} ${weightShort(unit)}`
  }
  return null
}

export const isValidWeight = (value: number, unit: string): boolean => weightError(value, unit) === null

// Resolve the lbs value to store when saving an edited weight. Weights are shown
// rounded to 0.1 in the display unit, so re-converting the shown value back to lbs
// drifts (e.g. 180 lb → 81.6 kg → 179.9 lb). If the shown value is unchanged from
// the original's rounded display, keep the original lbs exactly; only convert when
// the user actually changed it. `displayValue` is the (possibly-edited) field string.
export const resolveWeightLbs = (displayValue: string, originalLbs: number, unit: string): number => {
  const shown = parseFloat(displayValue)
  if (Number.isFinite(shown) && shown === displayWeight(originalLbs, unit)) return originalLbs
  return displayToLbs(shown, unit)
}
