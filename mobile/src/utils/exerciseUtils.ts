// Port of web/src/utils/exerciseUtils.ts (MUSCLE_COLORS / muscleColor) — keep in sync.
// RN adaptation: the web returns "bg-* text-*" class strings; here the text tint is
// an inline-style hex instead, because AppText always resolves a default text-color
// class and two color classes on one Text leave the winner to stylesheet order (see
// CONVENTIONS.md's font-size warning) — an inline style wins deterministically.
// The hexes are Tailwind's own *-400 palette values, identical to the web's
// text-*-400 classes; like the brand literals they are theme-independent.

export interface MuscleTint {
  /** NativeWind class for the badge background (bg only — no text class). */
  chip: string
  /** Badge text color — apply via AppText's inline `style`. */
  text: string
}

export const MUSCLE_COLORS: Record<string, MuscleTint> = {
  chest:      { chip: 'bg-red-500/20',    text: '#f87171' },
  back:       { chip: 'bg-blue-500/20',   text: '#60a5fa' },
  shoulders:  { chip: 'bg-orange-500/20', text: '#fb923c' },
  biceps:     { chip: 'bg-purple-500/20', text: '#c084fc' },
  triceps:    { chip: 'bg-pink-500/20',   text: '#f472b6' },
  legs:       { chip: 'bg-green-500/20',  text: '#4ade80' },
  quadriceps: { chip: 'bg-green-500/20',  text: '#4ade80' },
  hamstrings: { chip: 'bg-teal-500/20',   text: '#2dd4bf' },
  glutes:     { chip: 'bg-yellow-500/20', text: '#facc15' },
  calves:     { chip: 'bg-lime-500/20',   text: '#a3e635' },
  abdominals: { chip: 'bg-amber-500/20',  text: '#fbbf24' },
  core:       { chip: 'bg-amber-500/20',  text: '#fbbf24' },
  forearms:   { chip: 'bg-cyan-500/20',   text: '#22d3ee' },
  traps:      { chip: 'bg-indigo-500/20', text: '#818cf8' },
  lats:       { chip: 'bg-sky-500/20',    text: '#38bdf8' },
}

// null → caller renders the muted fallback (bg-surface-muted chip + colors.txMuted).
export function muscleColor(m: string): MuscleTint | null {
  return MUSCLE_COLORS[m?.toLowerCase()] ?? null
}
