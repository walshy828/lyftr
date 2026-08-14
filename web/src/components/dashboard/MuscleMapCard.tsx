import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PersonStanding, ArrowRight } from 'lucide-react'
import Model, { IExerciseData } from 'react-body-highlighter'
import { differenceInCalendarDays } from 'date-fns'
import { SectionHeader, SegmentedControl } from '../ui'
import { useTheme } from '../../hooks/useTheme'
import { muscleToBodySlugs } from '../../utils/exerciseUtils'
import {
  MUSCLE_RAMP_LIGHT, MUSCLE_RAMP_DARK,
  MUSCLE_NEGLECT_LIGHT, MUSCLE_NEGLECT_DARK,
  muscleIntensity,
} from '../../utils/chartTheme'
import * as types from '../../types'

export type MusclePeriod = 'week' | 'month' | 'all'

export const MUSCLE_PERIOD_DAYS: Record<MusclePeriod, number> = {
  week: 7,
  month: 30,
  all: 365,
}

const PERIOD_OPTIONS = [
  { value: 'week' as const, label: 'Week' },
  { value: 'month' as const, label: 'Month' },
  { value: 'all' as const, label: 'Year' },
]

interface Props {
  muscles: types.MuscleTotal[]
  period: MusclePeriod
  onPeriodChange: (p: MusclePeriod) => void
  /** Renders the figures larger, for the dedicated stats screen. */
  large?: boolean
}

function daysAgo(iso: string): number | null {
  if (!iso) return null
  return differenceInCalendarDays(new Date(), new Date(iso + 'T00:00:00'))
}

function lastTrainedLabel(m: types.MuscleTotal): string {
  const d = daysAgo(m.last_trained)
  if (d === null) return 'never trained'
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d} days ago`
}

/**
 * Front/back body map shaded by how much each muscle was trained — and, just as
 * deliberately, which ones weren't.
 *
 * The donut this replaces could only show the muscles that appeared in the
 * data, so it answered "what did I train" but never "what am I missing", which
 * is the question that actually changes what you do next. Untrained groups come
 * back from the server with explicit zeros so they can be drawn.
 */
export default function MuscleMapCard({ muscles, period, onPeriodChange, large }: Props) {
  const { isDark } = useTheme()
  const [selected, setSelected] = useState<types.MuscleTotal | null>(null)

  const ramp = isDark ? MUSCLE_RAMP_DARK : MUSCLE_RAMP_LIGHT
  const neglectColor = isDark ? MUSCLE_NEGLECT_DARK : MUSCLE_NEGLECT_LIGHT
  const bodyColor = isDark ? '#162240' : '#e2e8f0'

  const { bodyData, trained, neglected, maxSets } = useMemo(() => {
    const maxSets = muscles.reduce((m, x) => Math.max(m, x.sets), 0)
    const trained = muscles.filter(m => m.sets > 0).sort((a, b) => b.sets - a.sets)
    // Sort the untrained by how long it's been — the longest-neglected first is
    // the one worth acting on.
    const neglected = muscles
      .filter(m => m.sets === 0)
      .sort((a, b) => (daysAgo(b.last_trained) ?? 1e9) - (daysAgo(a.last_trained) ?? 1e9))

    // react-body-highlighter colors by `frequency`, indexing highlightedColors
    // at frequency-1. Slot 1 is the neglect status color; slots 2..5 are the
    // sequential ramp.
    const byFrequency = new Map<number, string[]>()
    const push = (freq: number, muscle: string) => {
      const slugs = muscleToBodySlugs(muscle)
      if (!slugs.length) return
      byFrequency.set(freq, [...(byFrequency.get(freq) ?? []), ...slugs])
    }
    neglected.forEach(m => push(1, m.muscle_group))
    trained.forEach(m => push(muscleIntensity(m.sets, maxSets) + 2, m.muscle_group))

    const bodyData: IExerciseData[] = [...byFrequency.entries()].map(([frequency, list]) => ({
      name: frequency === 1 ? 'Not trained' : 'Trained',
      muscles: [...new Set(list)] as never,
      frequency,
    }))

    return { bodyData, trained, neglected, maxSets }
  }, [muscles])

  const figureWidth = large ? 190 : 140
  const empty = muscles.length === 0 || (trained.length === 0 && neglected.length === 0)

  return (
    <div className="card p-4 min-w-0">
      <SectionHeader
        icon={PersonStanding}
        title="Muscle Coverage"
        right={
          <SegmentedControl
            options={PERIOD_OPTIONS}
            value={period}
            onChange={onPeriodChange}
            size="sm"
          />
        }
        className="mb-3"
      />

      {empty ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <PersonStanding className="w-6 h-6 text-tx-muted opacity-30" />
          <p className="text-xs text-tx-muted">Log workouts to map your training coverage</p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="w-full lg:w-auto flex-shrink-0">
            <div className="flex items-start justify-center gap-5">
              {(['anterior', 'posterior'] as const).map(type => (
                <div key={type} className="flex flex-col items-center gap-1">
                  <Model
                    data={bodyData}
                    type={type}
                    bodyColor={bodyColor}
                    highlightedColors={[neglectColor, ...ramp]}
                    style={{ width: `${figureWidth}px` }}
                  />
                  <span className="text-xs text-tx-muted">{type === 'anterior' ? 'Front' : 'Back'}</span>
                </div>
              ))}
            </div>

            {/* Identity is never color alone: the ramp and the neglect status
                both carry a written label. */}
            <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-tx-muted">Less</span>
                {ramp.map(c => (
                  <span key={c} className="w-3 h-3 rounded-sm" style={{ background: c }} />
                ))}
                <span className="text-[10px] text-tx-muted">More</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: neglectColor }} />
                <span className="text-[10px] text-tx-muted">Not trained</span>
              </div>
            </div>
          </div>

          <div className="flex-1 w-full min-w-0 space-y-3">
            {neglected.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: neglectColor }}>
                  Not trained this {period === 'all' ? 'year' : period}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {neglected.map(m => (
                    <button
                      key={m.muscle_group}
                      onClick={() => setSelected(selected?.muscle_group === m.muscle_group ? null : m)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium capitalize border transition-colors hover:brightness-110"
                      style={{ color: neglectColor, borderColor: `${neglectColor}55`, background: `${neglectColor}1a` }}
                    >
                      {m.muscle_group}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {trained.length > 0 && (
              <div className="space-y-1.5">
                {trained.slice(0, large ? 20 : 8).map(m => {
                  const pct = maxSets > 0 ? Math.round((m.sets / maxSets) * 100) : 0
                  const color = ramp[muscleIntensity(m.sets, maxSets)]
                  return (
                    <button
                      key={m.muscle_group}
                      onClick={() => setSelected(selected?.muscle_group === m.muscle_group ? null : m)}
                      className="w-full text-left group"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span className="text-xs capitalize flex-1 min-w-0 truncate text-tx-secondary group-hover:text-tx-primary transition-colors">
                          {m.muscle_group}
                        </span>
                        <span className="text-xs text-tx-muted tabular-nums flex-shrink-0">{m.sets} sets</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-bar transition-all" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {selected && (
              <div className="rounded-xl border border-surface-border bg-surface-muted/40 p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-tx-primary capitalize">{selected.muscle_group}</p>
                  <Link
                    to={`/exercises?muscle_group=${encodeURIComponent(selected.muscle_group)}`}
                    className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors flex-shrink-0"
                  >
                    Find exercises <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
                <p className="text-xs text-tx-muted">
                  {selected.sets > 0
                    ? `${selected.sets} sets · ${selected.reps} reps across ${selected.workouts} workout${selected.workouts === 1 ? '' : 's'}`
                    : 'No sets in this period'}
                </p>
                <p className="text-xs text-tx-muted">Last trained {lastTrainedLabel(selected)}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
