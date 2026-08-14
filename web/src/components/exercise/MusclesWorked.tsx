import { useMemo } from 'react'
import Model, { IExerciseData } from 'react-body-highlighter'
import { useTheme } from '../../hooks/useTheme'
import { muscleToBodySlugs } from '../../utils/exerciseUtils'
import { MUSCLE_RAMP_LIGHT, MUSCLE_RAMP_DARK, muscleIntensity } from '../../utils/chartTheme'
import * as types from '../../types'

/**
 * What a single session actually hit, shaded by set count.
 *
 * Computed from the workout's own exercises rather than the stats endpoint —
 * the data is already loaded on this page, and one session's totals need no
 * server aggregate. Neglect has no meaning here: a push day is supposed to skip
 * legs, so untrained muscles stay neutral rather than flagged.
 */
export default function MusclesWorked({ exercises }: { exercises: types.WorkoutExercise[] }) {
  const { isDark } = useTheme()
  const ramp = isDark ? MUSCLE_RAMP_DARK : MUSCLE_RAMP_LIGHT
  const bodyColor = isDark ? '#162240' : '#e2e8f0'

  const { bodyData, worked } = useMemo(() => {
    const setsByMuscle = new Map<string, number>()
    for (const ex of exercises ?? []) {
      const mg = ex.exercise?.muscle_group
      if (!mg || ex.exercise?.category === 'cardio') continue
      const n = (ex.sets ?? []).filter(s => s.completed !== false && !s.is_warmup).length
      if (n > 0) setsByMuscle.set(mg, (setsByMuscle.get(mg) ?? 0) + n)
    }

    const worked = [...setsByMuscle.entries()]
      .map(([muscle_group, sets]) => ({ muscle_group, sets }))
      .sort((a, b) => b.sets - a.sets)
    const max = worked.reduce((m, x) => Math.max(m, x.sets), 0)

    const byFrequency = new Map<number, string[]>()
    for (const w of worked) {
      const slugs = muscleToBodySlugs(w.muscle_group)
      if (!slugs.length) continue
      const freq = muscleIntensity(w.sets, max) + 1
      byFrequency.set(freq, [...(byFrequency.get(freq) ?? []), ...slugs])
    }
    const bodyData: IExerciseData[] = [...byFrequency.entries()].map(([frequency, list]) => ({
      name: 'Worked',
      muscles: [...new Set(list)] as never,
      frequency,
    }))

    return { bodyData, worked }
  }, [exercises])

  if (worked.length === 0) return null

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider mb-3">Muscles Worked</p>
      <div className="flex items-start justify-center gap-5">
        {(['anterior', 'posterior'] as const).map(type => (
          <div key={type} className="flex flex-col items-center gap-1">
            <Model
              data={bodyData}
              type={type}
              bodyColor={bodyColor}
              highlightedColors={[...ramp]}
              style={{ width: '130px' }}
            />
            <span className="text-xs text-tx-muted">{type === 'anterior' ? 'Front' : 'Back'}</span>
          </div>
        ))}
      </div>
      {/* Names and counts in text, so the figure never has to carry the
          information alone. */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
        {worked.map(w => (
          <span
            key={w.muscle_group}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium capitalize border border-surface-border bg-surface-muted/40 text-tx-secondary"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: ramp[muscleIntensity(w.sets, worked[0].sets)] }}
            />
            {w.muscle_group}
            <span className="text-tx-muted tabular-nums">{w.sets}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
