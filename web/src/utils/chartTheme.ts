// Shared chart theming + color system for all Recharts / SVG visuals.
//
// Recharts can't consume Tailwind classes, so colors are hex here. Tooltip and
// axis styling reference the REAL theme tokens defined in index.css
// (`--surface-raised`, `--tx-muted`, … — NO `--color-` prefix). The old
// dashboard referenced `var(--color-tx-muted, …)` etc., which don't exist, so
// every tooltip/axis silently fell back to a hardcoded dark color even in light
// mode. Using the correct tokens here fixes theming in both modes.

import type { CSSProperties } from 'react'

// ── Tooltip / axis / grid ──────────────────────────────────────────────
export const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--surface-border)',
  borderRadius: 8,
  fontSize: 11,
  color: 'var(--tx-primary)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
}

// Axis tick label fill — resolves to --tx-muted in whichever mode is active.
export const AXIS_TICK = { fontSize: 10, fill: 'var(--tx-muted)' } as const
export const GRID_STROKE = 'var(--surface-border)'
export const CURSOR_FILL = 'rgba(99,102,241,0.08)'

// ── Energy + macro colors (validated: cal/protein/carb all-pairs pass CVD +
// normal-vision floors in both modes; see dataviz validator). ──────────────
export const ENERGY_COLORS = {
  calories: '#00b8d9', // brand cyan
  protein: '#3b82f6', // blue
  carbs: '#f59e0b', // amber
  fat: '#8b5cf6', // violet
} as const

// ── Workout focus categories (validated all-pairs, both modes: worst pair
// magenta↔green ΔE 6.1 sits in the CVD floor band — legal because focus is
// always paired with a legend and a text label). Replaces the old
// blue/violet pair that was CVD ΔE 1.3 (invisible to colorblind users). ────
export type FocusCategory = 'Upper' | 'Lower' | 'Core' | 'Full Body'
export const FOCUS_HEX: Record<FocusCategory, string> = {
  Upper: '#2563eb',
  Lower: '#16a34a',
  Core: '#d97706',
  'Full Body': '#db2777',
}
export const FOCUS_ORDER: FocusCategory[] = ['Upper', 'Lower', 'Core', 'Full Body']

// Maps the fine-grained muscle_group taxonomy → a coarse focus category.
const MUSCLE_TO_FOCUS: Record<string, FocusCategory> = {
  chest: 'Upper', back: 'Upper', shoulders: 'Upper', biceps: 'Upper', triceps: 'Upper',
  forearms: 'Upper', traps: 'Upper', lats: 'Upper', 'middle back': 'Upper', neck: 'Upper',
  legs: 'Lower', quadriceps: 'Lower', hamstrings: 'Lower', glutes: 'Lower', calves: 'Lower',
  core: 'Core', abs: 'Core', abdominals: 'Core', obliques: 'Core', 'lower back': 'Core',
  'full body': 'Full Body',
}
export const focusOf = (muscleGroup: string): FocusCategory | null =>
  MUSCLE_TO_FOCUS[muscleGroup?.toLowerCase()] ?? null

// ── Plan / weight-trend colors (shared with WeightPlan.tsx) ─────────────
export const PLAN_COLOR = '#10b981' // plan line (green)
export const ACTUAL_COLOR = '#6366f1' // actual weight (indigo)
export const FORECAST_COLOR = ACTUAL_COLOR // forecast = actual, dashed + dimmed

// BMI zone band colors — background context, distinct from the series above.
export const ZONE_COLORS = {
  underweight: '#0ea5e9',
  healthy: '#10b981',
  overweight: '#f59e0b',
  obese: '#ef4444',
} as const

// ── Muscle group donut colors ──────────────────────────────────────────
const MUSCLE_HEX: Record<string, string> = {
  chest: '#f87171', back: '#60a5fa', shoulders: '#818cf8', biceps: '#f472b6',
  triceps: '#a78bfa', legs: '#34d399', quadriceps: '#34d399', hamstrings: '#6ee7b7',
  glutes: '#86efac', calves: '#4ade80', core: '#fbbf24', abs: '#fbbf24',
  forearms: '#fb923c', traps: '#94a3b8', lats: '#38bdf8', 'full body': '#e879f9',
}
export const muscleHex = (m: string) => MUSCLE_HEX[m?.toLowerCase()] ?? '#6366f1'
