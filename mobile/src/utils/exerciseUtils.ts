// Port of web/src/utils/exerciseUtils.ts (MUSCLE_COLORS / muscleColor /
// EQUIPMENT_LABEL) — keep in sync.
// RN adaptation: the web returns "bg-* text-* border-*" class strings; here the text
// tint is an inline-style hex instead, because AppText always resolves a default
// text-color class and two color classes on one Text leave the winner to stylesheet
// order (see CONVENTIONS.md's font-size warning) — an inline style wins
// deterministically. The hexes are Tailwind's own *-400 palette values, identical to
// the web's text-*-400 classes; like the brand literals they are theme-independent.
// `border` carries the web muscleColorBordered() border class for the picker badges;
// borderless badges (detail screen) simply don't apply it.

export interface MuscleTint {
  /** NativeWind class for the badge background (bg only — no text class). */
  chip: string
  /** NativeWind border-color class (web's muscleColorBordered variant). */
  border: string
  /** Badge text color — apply via AppText's inline `style`. */
  text: string
}

export const MUSCLE_COLORS: Record<string, MuscleTint> = {
  chest:      { chip: 'bg-red-500/20',    border: 'border-red-500/30',    text: '#f87171' },
  back:       { chip: 'bg-blue-500/20',   border: 'border-blue-500/30',   text: '#60a5fa' },
  shoulders:  { chip: 'bg-orange-500/20', border: 'border-orange-500/30', text: '#fb923c' },
  biceps:     { chip: 'bg-purple-500/20', border: 'border-purple-500/30', text: '#c084fc' },
  triceps:    { chip: 'bg-pink-500/20',   border: 'border-pink-500/30',   text: '#f472b6' },
  legs:       { chip: 'bg-green-500/20',  border: 'border-green-500/30',  text: '#4ade80' },
  quadriceps: { chip: 'bg-green-500/20',  border: 'border-green-500/30',  text: '#4ade80' },
  hamstrings: { chip: 'bg-teal-500/20',   border: 'border-teal-500/30',   text: '#2dd4bf' },
  glutes:     { chip: 'bg-yellow-500/20', border: 'border-yellow-500/30', text: '#facc15' },
  calves:     { chip: 'bg-lime-500/20',   border: 'border-lime-500/30',   text: '#a3e635' },
  abdominals: { chip: 'bg-amber-500/20',  border: 'border-amber-500/30',  text: '#fbbf24' },
  core:       { chip: 'bg-amber-500/20',  border: 'border-amber-500/30',  text: '#fbbf24' },
  forearms:   { chip: 'bg-cyan-500/20',   border: 'border-cyan-500/30',   text: '#22d3ee' },
  traps:      { chip: 'bg-indigo-500/20', border: 'border-indigo-500/30', text: '#818cf8' },
  lats:       { chip: 'bg-sky-500/20',    border: 'border-sky-500/30',    text: '#38bdf8' },
}

// Port of web EQUIPMENT_LABEL — keep in sync.
export const EQUIPMENT_LABEL: Record<string, string> = {
  'body only':     'Bodyweight',
  'barbell':       'Barbell',
  'dumbbell':      'Dumbbell',
  'machine':       'Machine',
  'cable':         'Cable',
  'kettlebells':   'Kettlebell',
  'bands':         'Bands',
  'medicine ball': 'Med Ball',
  'other':         'Other',
  'foam roll':     'Foam Roll',
}

// null → caller renders the muted fallback (bg-surface-muted chip + colors.txMuted).
export function muscleColor(m: string): MuscleTint | null {
  return MUSCLE_COLORS[m?.toLowerCase()] ?? null
}
