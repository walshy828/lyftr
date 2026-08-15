export const MUSCLE_COLORS: Record<string, string> = {
  chest:      'bg-red-500/20 text-red-400 border-red-500/30',
  back:       'bg-blue-500/20 text-blue-400 border-blue-500/30',
  shoulders:  'bg-orange-500/20 text-orange-400 border-orange-500/30',
  biceps:     'bg-purple-500/20 text-purple-400 border-purple-500/30',
  triceps:    'bg-pink-500/20 text-pink-400 border-pink-500/30',
  legs:       'bg-green-500/20 text-green-400 border-green-500/30',
  quadriceps: 'bg-green-500/20 text-green-400 border-green-500/30',
  hamstrings: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  glutes:     'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  calves:     'bg-lime-500/20 text-lime-400 border-lime-500/30',
  abdominals: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  core:       'bg-amber-500/20 text-amber-400 border-amber-500/30',
  forearms:   'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  traps:      'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  lats:       'bg-sky-500/20 text-sky-400 border-sky-500/30',
}

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

// Exercise names come from mixed-case sources (Title Case, all-lowercase,
// and free-typed custom names) — normalize to Title Case for display so the
// app reads consistently regardless of source casing.
export function formatExerciseName(name: string): string {
  return (name ?? '')
    .split(' ')
    .map(word => word
      .split('-')
      .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part)
      .join('-'))
    .join(' ')
}

export function muscleColor(m: string): string {
  const full = MUSCLE_COLORS[m?.toLowerCase()] || 'bg-surface-muted text-tx-muted border-surface-border'
  return full.split(' ').filter(c => !c.startsWith('border-')).join(' ')
}

export function muscleColorBordered(m: string): string {
  return MUSCLE_COLORS[m?.toLowerCase()] || 'bg-surface-muted text-tx-muted border-surface-border'
}

// Maps our muscle group names + common secondary muscle names → react-body-highlighter slugs
const MUSCLE_TO_BODY_SLUG: Record<string, string[]> = {
  chest: ['chest'],
  back: ['upper-back', 'lower-back'],
  shoulders: ['front-deltoids', 'back-deltoids'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  legs: ['quadriceps', 'hamstring', 'calves', 'gluteal'],
  quadriceps: ['quadriceps'],
  hamstrings: ['hamstring'],
  hamstring: ['hamstring'],
  glutes: ['gluteal'],
  gluteal: ['gluteal'],
  calves: ['calves'],
  abdominals: ['abs'],
  abs: ['abs'],
  core: ['abs', 'obliques'],
  obliques: ['obliques'],
  forearms: ['forearm'],
  forearm: ['forearm'],
  traps: ['trapezius'],
  trapezius: ['trapezius'],
  lats: ['upper-back'],
  neck: ['neck'],
  // secondary muscle names from exercise DB
  'anterior deltoid': ['front-deltoids'],
  'front deltoid': ['front-deltoids'],
  'posterior deltoid': ['back-deltoids'],
  'rear deltoid': ['back-deltoids'],
  deltoids: ['front-deltoids', 'back-deltoids'],
  'serratus anterior': ['abs'],
  rhomboids: ['upper-back'],
  'spinal erectors': ['lower-back'],
  erectors: ['lower-back'],
  'lower back': ['lower-back'],
  'upper back': ['upper-back'],
  'hip flexors': ['adductor'],
  adductors: ['adductor'],
  abductors: ['abductors'],
}

export function muscleToBodySlugs(m: string): string[] {
  const key = m?.toLowerCase().trim()
  if (!key) return []
  if (MUSCLE_TO_BODY_SLUG[key]) return MUSCLE_TO_BODY_SLUG[key]
  // partial match fallback
  for (const [k, v] of Object.entries(MUSCLE_TO_BODY_SLUG)) {
    if (key.includes(k) || k.includes(key)) return v
  }
  return []
}

// Coarse region buckets for a workout's "focus" badge — collapses the
// fine-grained muscle_group taxonomy (used above for body-heatmap slugs)
// down to 3 buckets simple enough to summarize a whole workout in one word.
export type MuscleRegion = 'upper' | 'lower' | 'core'
const MUSCLE_TO_REGION: Record<string, MuscleRegion> = {
  chest: 'upper', back: 'upper', shoulders: 'upper', biceps: 'upper', triceps: 'upper',
  lats: 'upper', traps: 'upper', forearms: 'upper', 'middle back': 'upper', neck: 'upper',
  quadriceps: 'lower', hamstrings: 'lower', legs: 'lower', glutes: 'lower', calves: 'lower',
  abdominals: 'core', abs: 'core', core: 'core', obliques: 'core', 'lower back': 'core',
}

export function regionOf(muscleGroup: string): MuscleRegion {
  return MUSCLE_TO_REGION[muscleGroup?.toLowerCase()] ?? 'upper'
}

export type WorkoutFocus = 'balanced' | 'upper' | 'lower' | 'core'

// Structural shape shared by Workout and Program — lets the same focus
// computation summarize either a logged workout or a program template.
interface FocusSource {
  exercises?: { exercise: { muscle_group: string; category?: string }; sets?: unknown[] }[]
}

// Buckets a workout's (or program's) sets by muscle region and calls it
// "focused" on whichever region has >=65% of total sets; otherwise
// "balanced". Returns null when there are no sets (e.g. cardio-only) — no
// badge to show.
export function computeWorkoutFocus(workout: FocusSource): WorkoutFocus | null {
  const counts: Record<MuscleRegion, number> = { upper: 0, lower: 0, core: 0 }
  let totalSets = 0
  for (const ex of workout.exercises ?? []) {
    // Cardio (walk/run/bike) has no muscle-region focus — skip it so a
    // cardio-only workout returns null (no badge) rather than defaulting
    // to "upper".
    if (ex.exercise?.category === 'cardio') continue
    const region = regionOf(ex.exercise?.muscle_group)
    const n = ex.sets?.length ?? 0
    counts[region] += n
    totalSets += n
  }
  if (totalSets === 0) return null
  const shares = Object.entries(counts).map(([region, n]) => [region, n / totalSets] as const)
  const [topRegion, topShare] = shares.sort((a, b) => b[1] - a[1])[0]
  return topShare >= 0.65 ? (topRegion as WorkoutFocus) : 'balanced'
}

// Body-part tabs for the exercise browse page (/exercises) — the familiar
// ExerciseDB-style taxonomy (Back, Chest, Upper Arms, ...), collapsing the
// finer free-exercise-db muscle_group values that back MUSCLE_COLORS above.
// Distinct from MuscleRegion (upper/lower/core), which is a 3-bucket summary
// for a whole workout's "focus" badge, not a browse filter.
export interface BodyPartGroup {
  key: string
  label: string
  muscleGroups: string[]
}

export const BODY_PART_GROUPS: BodyPartGroup[] = [
  { key: 'back', label: 'Back', muscleGroups: ['back', 'lats', 'traps', 'upper back', 'middle back', 'lower back'] },
  { key: 'chest', label: 'Chest', muscleGroups: ['chest'] },
  { key: 'shoulders', label: 'Shoulders', muscleGroups: ['shoulders', 'deltoids'] },
  { key: 'upper_arms', label: 'Upper Arms', muscleGroups: ['biceps', 'triceps'] },
  { key: 'lower_arms', label: 'Lower Arms', muscleGroups: ['forearms', 'forearm'] },
  { key: 'upper_legs', label: 'Upper Legs', muscleGroups: ['quadriceps', 'hamstrings', 'hamstring', 'glutes', 'gluteal', 'legs', 'adductors', 'abductors'] },
  { key: 'lower_legs', label: 'Lower Legs', muscleGroups: ['calves'] },
  { key: 'waist', label: 'Waist', muscleGroups: ['abdominals', 'abs', 'core', 'obliques'] },
  { key: 'neck', label: 'Neck', muscleGroups: ['neck'] },
]

const MUSCLE_TO_BODY_PART: Record<string, string> = Object.fromEntries(
  BODY_PART_GROUPS.flatMap(g => g.muscleGroups.map(m => [m, g.key]))
)

/**
 * Which body-part tab an exercise belongs under. Cardio exercises get their
 * own tab regardless of muscle_group (Row is "back", Swim is "full body",
 * etc. — none of that is meaningful to someone browsing by cardio).
 * Falls back to 'other' for anything unmapped rather than dropping it.
 */
export function bodyPartOf(exercise: { muscle_group: string; category: string }): string {
  if (exercise.category === 'cardio') return 'cardio'
  return MUSCLE_TO_BODY_PART[exercise.muscle_group?.toLowerCase()] ?? 'other'
}
