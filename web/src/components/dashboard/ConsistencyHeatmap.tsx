import { useMemo } from 'react'
import { Activity, Flame } from 'lucide-react'
import { format, startOfWeek, endOfWeek, subWeeks, eachDayOfInterval } from 'date-fns'
import { SectionHeader, SegmentedControl } from '../ui'
import * as types from '../../types'

const NOW = new Date()

/** How a day's square is shaded. */
export type HeatmapMetric = 'workouts' | 'duration'

/**
 * Which domain the heatmap displays. 'both' sums a day's workout and cardio
 * values into a single blended shade — one number on the same 4-step scale,
 * not a split square — since a day with one workout and one cardio session
 * is still just "a day I showed up."
 */
export type ConsistencySource = 'workouts' | 'cardio' | 'both'

const SOURCE_OPTIONS = [
  { value: 'both' as const, label: 'Both' },
  { value: 'workouts' as const, label: 'Strength' },
  { value: 'cardio' as const, label: 'Cardio' },
]

interface Props {
  /** Server-computed per-day workout rollups. Days with no training are simply absent. */
  workoutDaily: types.TrainingDay[]
  /** Server-computed per-day cardio rollups (Health Connect sync). */
  cardioDaily?: types.CardioDay[]
  /** Weeks to display, counting back from the current week. */
  weeks?: number
  /**
   * Binary "did I show up" (workouts) or graded by time invested (duration).
   * Duration reads better over a long span, where almost every filled square
   * would otherwise be the same shade.
   */
  metric?: HeatmapMetric
  source: ConsistencySource
  onSourceChange: (s: ConsistencySource) => void
  /** The streak matching `source` — the caller picks it (workout / cardio / combined). */
  streak?: types.TrainingStreak
}

// Four buckets, matched to the four-step legend. Intensity is relative to the
// user's own busiest day rather than an absolute scale: a 20-minute-a-day user
// should still see contrast, not a uniformly pale grid.
function bucket(value: number, max: number): 0 | 1 | 2 | 3 {
  if (value <= 0) return 0
  if (max <= 0) return 0
  const ratio = value / max
  if (ratio > 0.66) return 3
  if (ratio > 0.33) return 2
  return 1
}

const FILL: Record<0 | 1 | 2 | 3, string> = {
  // Rest days need enough contrast to read as squares. Over a long window they
  // are most of the grid, and if they fade into the card the calendar looks
  // like it simply starts at the user's first workout.
  0: 'bg-surface-muted',
  1: 'bg-brand-500/30',
  2: 'bg-brand-500/60',
  3: 'bg-brand-500',
}

/**
 * The value a day's square is bucketed on, for the given source/metric. 'both'
 * sums the two domains into one number — this is the entirety of the "blended
 * shade" behavior; everything downstream (bucket(), FILL) is unchanged.
 */
export function mergeConsistencyValue(
  workoutDay: types.TrainingDay | undefined,
  cardioDay: types.CardioDay | undefined,
  source: ConsistencySource,
  metric: HeatmapMetric,
): number {
  const workoutValue = metric === 'duration' ? (workoutDay?.duration ?? 0) : (workoutDay?.workouts ?? 0)
  const cardioValue = metric === 'duration' ? (cardioDay?.duration ?? 0) : (cardioDay?.sessions ?? 0)
  if (source === 'workouts') return workoutValue
  if (source === 'cardio') return cardioValue
  return workoutValue + cardioValue
}

function tooltip(
  day: Date,
  source: ConsistencySource,
  w: types.TrainingDay | undefined,
  c: types.CardioDay | undefined,
): string {
  const date = format(day, 'MMM d')
  const parts: string[] = []
  if (source !== 'cardio' && w) {
    parts.push(`${w.workouts} workout${w.workouts > 1 ? 's' : ''}`)
    const mins = Math.round(w.duration / 60)
    if (mins > 0) parts.push(`${mins} min`)
  }
  if (source !== 'workouts' && c) {
    parts.push(`${c.sessions} cardio session${c.sessions > 1 ? 's' : ''}`)
    const mins = Math.round(c.duration / 60)
    if (mins > 0) parts.push(`${mins} min`)
  }
  return parts.length ? `${date} · ${parts.join(' · ')}` : date
}

const EMPTY_COPY: Record<ConsistencySource, string> = {
  workouts: 'Start working out to build your streak',
  cardio: 'Sync a cardio session to build your streak',
  both: 'Start training to build your streak',
}

// GitHub-style contribution grid — "am I showing up consistently?"
//
// Fed by the server's daily rollups rather than a page of workouts: the old
// version reduced over whatever the workout list happened to return, so the
// grid quietly went blank past however many sessions had been fetched.
export default function ConsistencyHeatmap({
  workoutDaily, cardioDaily = [], weeks = 12, metric = 'workouts', source, onSourceChange, streak,
}: Props) {
  const { weekCols, monthLabels, byDate, cardioByDate, max } = useMemo(() => {
    const start = startOfWeek(subWeeks(NOW, weeks - 1), { weekStartsOn: 1 })
    const end = endOfWeek(NOW, { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start, end })

    const byDate = new Map(workoutDaily.map(d => [d.date, d]))
    const cardioByDate = new Map(cardioDaily.map(d => [d.date, d]))

    // Relative to the DISPLAYED source's own max, so a cardio-only window
    // isn't diluted by workout days that don't apply (and vice versa).
    const allDates = new Set([...byDate.keys(), ...cardioByDate.keys()])
    let max = 0
    allDates.forEach(date => {
      max = Math.max(max, mergeConsistencyValue(byDate.get(date), cardioByDate.get(date), source, metric))
    })

    const weekCols: Date[][] = []
    for (let i = 0; i < days.length; i += 7) weekCols.push(days.slice(i, i + 7))

    // A label is drawn on the first column of each month, but only if it clears
    // the previous one. Columns are ~12px and a label is ~22px, so adjacent
    // labels would overlap into "MayJun" — which is what happens when a month
    // boundary lands in the grid's first week or two.
    const MIN_LABEL_GAP = 3
    let lastLabelled = -MIN_LABEL_GAP
    const monthLabels = weekCols.map((week, i) => {
      const m = format(week[0], 'MMM')
      const isBoundary = i === 0 || m !== format(weekCols[i - 1][0], 'MMM')
      if (!isBoundary || i - lastLabelled < MIN_LABEL_GAP) return null
      lastLabelled = i
      return m
    })

    return { weekCols, monthLabels, byDate, cardioByDate, max }
  }, [workoutDaily, cardioDaily, weeks, metric, source])

  const empty = source === 'cardio'
    ? cardioDaily.length === 0
    : source === 'workouts'
      ? workoutDaily.length === 0
      : workoutDaily.length === 0 && cardioDaily.length === 0

  return (
    <div className="card p-4">
      <SectionHeader
        icon={Activity}
        title="Consistency"
        right={
          <div className="flex items-center gap-2">
            {streak && streak.current > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
                <Flame className="w-3.5 h-3.5" />
                {streak.current} day{streak.current > 1 ? 's' : ''}
              </span>
            )}
            <span className="text-xs text-tx-muted">{weeks} weeks</span>
          </div>
        }
        className="mb-3"
      />
      <SegmentedControl options={SOURCE_OPTIONS} value={source} onChange={onSourceChange} size="sm" className="mb-3" />
      {empty ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <p className="text-xs text-tx-muted">{EMPTY_COPY[source]}</p>
        </div>
      ) : (
        <>
          {/* Fixed-width columns rather than 1fr: stretched-to-fit columns turn
              the squares into wide bars, which reads as a bar chart instead of a
              calendar. A full year overflows instead, and scrolls. */}
          <div className="overflow-x-auto no-scrollbar">
            <div
              style={{ display: 'grid', gridTemplateColumns: `1.25rem repeat(${weekCols.length}, 0.75rem)`, gap: '2px', justifyContent: 'start' }}
            >
              <div />
              {weekCols.map((_, i) => (
                <div key={i} className="text-[9px] text-tx-muted font-medium overflow-visible whitespace-nowrap leading-none pb-0.5">
                  {monthLabels[i] ?? ''}
                </div>
              ))}
              {(['M', '', 'W', '', 'F', '', 'S'] as const).map((lbl, dayIdx) => [
                <div key={`lbl-${dayIdx}`} className="text-[9px] text-tx-muted/60 font-medium flex items-center leading-none">{lbl}</div>,
                ...weekCols.map((week, wi) => {
                  const day = week[dayIdx]
                  const dateKey = format(day, 'yyyy-MM-dd')
                  const wRec = byDate.get(dateKey)
                  const cRec = cardioByDate.get(dateKey)
                  const value = mergeConsistencyValue(wRec, cRec, source, metric)
                  const future = day > NOW
                  return (
                    <div
                      key={`${wi}-${dayIdx}`}
                      title={tooltip(day, source, wRec, cRec)}
                      className={`w-3 h-3 rounded-[2px] transition-colors ${
                        future ? 'bg-surface-muted/20' : FILL[bucket(value, max)]
                      }`}
                    />
                  )
                }),
              ])}
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-2 justify-end">
            <span className="text-[9px] text-tx-muted">Less</span>
            {([0, 1, 2, 3] as const).map(i => (
              <div key={i} className={`w-3 h-3 rounded-[3px] ${FILL[i]}`} />
            ))}
            <span className="text-[9px] text-tx-muted">More</span>
          </div>
        </>
      )}
    </div>
  )
}
