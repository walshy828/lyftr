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

// ── Activity categories = Cardio + the four strength focuses. Used by the
// training-trends stack to answer "how much cardio vs strength, and which
// areas?" in one view. Cardio sky (#0891b2) was validated all-pairs against
// the four focus hexes in both modes (dataviz validator): ALL CHECKS PASS,
// the only WARN being the same magenta↔green ΔE 6.1 the focus palette already
// carries — legal because the stack ships with a legend + a text tooltip. ──
export type ActivityCategory = 'Cardio' | FocusCategory
export const CARDIO_HEX = '#0891b2'
export const ACTIVITY_HEX: Record<ActivityCategory, string> = { Cardio: CARDIO_HEX, ...FOCUS_HEX }
// Cardio first (bottom of the stack), then strength focuses. Full Body last so
// its rare presence sits at the rounded top of the bar.
export const ACTIVITY_ORDER: ActivityCategory[] = ['Cardio', 'Upper', 'Lower', 'Core', 'Full Body']

// ── Muscle-coverage map ────────────────────────────────────────────────
//
// This encoding is SEQUENTIAL (how much was this muscle trained), not
// categorical, so the rule is one hue in monotonic lightness steps rather than
// distinct hues. Cyan, the brand hue, with the anchor flipped per mode: on a
// light card more work reads DARKER, on a dark card more work reads BRIGHTER.
// A single ramp used in both modes would make the busiest muscle the least
// visible one in whichever mode it wasn't chosen for.
//
// "Neglected" is a STATUS color, not another ramp step — it answers a different
// question ("you have not trained this at all") and must never be mistakable
// for "trained a little". Validated with the dataviz validator against every
// ramp step in both modes: worst pair ΔE 14.7 CVD / 24.6 normal (light) and
// 20.9 / 28.2 (dark) — comfortably clear of the 8 / 15 floors. It ships with a
// legend and a text label, never as color alone.
//
// The three lightest light-mode steps sit below 3:1 on a white card. That WARN
// is discharged by the per-muscle list rendered beside the figure, which gives
// every muscle a name and a set count in text — the figure is the overview, the
// list is the readable record.
export const MUSCLE_RAMP_LIGHT = ['#67e8f9', '#22d3ee', '#06b6d4', '#0e7490'] as const
export const MUSCLE_RAMP_DARK = ['#0e7490', '#0891b2', '#06b6d4', '#22d3ee'] as const
export const MUSCLE_NEGLECT_LIGHT = '#b45309'
export const MUSCLE_NEGLECT_DARK = '#f59e0b'

/** Bucket a muscle's set count into a ramp index, relative to the user's own busiest muscle. */
export function muscleIntensity(sets: number, max: number): number {
  if (sets <= 0 || max <= 0) return -1
  const ratio = sets / max
  if (ratio > 0.75) return 3
  if (ratio > 0.5) return 2
  if (ratio > 0.25) return 1
  return 0
}

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

// ── Blood pressure ─────────────────────────────────────────────────────
// Both series share one Y axis deliberately: a second axis would let the lines
// cross and imply a relationship between systolic and diastolic that isn't there.
export const BP_SYS_COLOR = '#6366f1' // indigo, same role as ACTUAL_COLOR
export const BP_DIA_COLOR = '#0891b2' // cyan — distinguishable from indigo in both themes

// ACC/AHA category bands, drawn behind the series against the systolic scale.
export const BP_ZONE_COLORS = {
  low: '#0ea5e9',
  normal: '#10b981',
  elevated: '#f59e0b',
  stage1: '#f97316',
  stage2: '#ef4444',
  crisis: '#b91c1c',
} as const

// ── Heart-rate zones ────────────────────────────────────────────────────
// Sequential cool→hot ramp (blue → green → amber → orange → red) so "more
// intense zone" reads as "hotter" regardless of theme — same instinct as a
// gym heart-rate display. belowZone1 (warm-up/recovery) is a neutral grey
// rather than the coolest hue in the ramp, since it isn't a training zone.
export const HR_ZONE_COLORS = {
  belowZone1: '#94a3b8',
  zone1: '#0ea5e9',
  zone2: '#10b981',
  zone3: '#f59e0b',
  zone4: '#f97316',
  zone5: '#ef4444',
} as const

// ── Sleep stages ────────────────────────────────────────────────────────
// Categorical, four distinct hues chosen for clear separation on a stacked
// stage timeline in both themes — deep sleep gets the darkest/most saturated
// color since it's the stage users most care about tracking.
export const SLEEP_STAGE_COLORS = {
  awake: '#f59e0b',
  light: '#60a5fa',
  deep: '#4338ca',
  rem: '#a78bfa',
} as const

// Cadence line series — reuses the cardio hue so cadence reads as "part of
// the cardio-session family" rather than introducing another accent color.
export const CADENCE_COLOR = CARDIO_HEX

// ── Muscle group donut colors ──────────────────────────────────────────
const MUSCLE_HEX: Record<string, string> = {
  chest: '#f87171', back: '#60a5fa', shoulders: '#818cf8', biceps: '#f472b6',
  triceps: '#a78bfa', legs: '#34d399', quadriceps: '#34d399', hamstrings: '#6ee7b7',
  glutes: '#86efac', calves: '#4ade80', core: '#fbbf24', abs: '#fbbf24',
  forearms: '#fb923c', traps: '#94a3b8', lats: '#38bdf8', 'full body': '#e879f9',
}
export const muscleHex = (m: string) => MUSCLE_HEX[m?.toLowerCase()] ?? '#6366f1'
