import { useMemo } from 'react'
import { Activity, Flame } from 'lucide-react'
import { format, startOfWeek, endOfWeek, subWeeks, eachDayOfInterval } from 'date-fns'
import { SectionHeader } from '../ui'
import * as types from '../../types'

const NOW = new Date()

/** How a day's square is shaded. */
export type HeatmapMetric = 'workouts' | 'duration'

interface Props {
  /** Server-computed per-day rollups. Days with no training are simply absent. */
  daily: types.TrainingDay[]
  /** Weeks to display, counting back from the current week. */
  weeks?: number
  /**
   * Binary "did I show up" (workouts) or graded by time invested (duration).
   * Duration reads better over a long span, where almost every filled square
   * would otherwise be the same shade.
   */
  metric?: HeatmapMetric
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

function tooltip(day: Date, d: types.TrainingDay | undefined): string {
  const date = format(day, 'MMM d')
  if (!d) return date
  const mins = Math.round(d.duration / 60)
  const parts = [`${d.workouts} workout${d.workouts > 1 ? 's' : ''}`]
  if (mins > 0) parts.push(`${mins} min`)
  if (d.sets > 0) parts.push(`${d.sets} sets`)
  return `${date} · ${parts.join(' · ')}`
}

// GitHub-style contribution grid — "am I showing up consistently?"
//
// Fed by the server's daily rollups rather than a page of workouts: the old
// version reduced over whatever the workout list happened to return, so the
// grid quietly went blank past however many sessions had been fetched.
export default function ConsistencyHeatmap({ daily, weeks = 12, metric = 'workouts', streak }: Props) {
  const { weekCols, monthLabels, byDate, max } = useMemo(() => {
    const start = startOfWeek(subWeeks(NOW, weeks - 1), { weekStartsOn: 1 })
    const end = endOfWeek(NOW, { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start, end })

    const byDate = new Map(daily.map(d => [d.date, d]))
    const max = daily.reduce((m, d) => Math.max(m, metric === 'duration' ? d.duration : d.workouts), 0)

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

    return { weekCols, monthLabels, byDate, max }
  }, [daily, weeks, metric])

  const empty = daily.length === 0

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
      {empty ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <p className="text-xs text-tx-muted">Start working out to build your streak</p>
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
                  const rec = byDate.get(format(day, 'yyyy-MM-dd'))
                  const value = rec ? (metric === 'duration' ? rec.duration : rec.workouts) : 0
                  const future = day > NOW
                  return (
                    <div
                      key={`${wi}-${dayIdx}`}
                      title={tooltip(day, rec)}
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
