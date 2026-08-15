import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Flame, Trophy, Dumbbell, Clock, TrendingUp, ArrowRight, HeartPulse } from 'lucide-react'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { workoutAPI, exerciseAPI } from '../services/api'
import { useTrainingStats } from '../hooks/useTrainingStats'
import { useCardioStats } from '../hooks/useCardioStats'
import { useSettingsStore, weightShort, displayWeight, displayVolume } from '../stores/settings'
import ConsistencyHeatmap, { type ConsistencySource } from '../components/dashboard/ConsistencyHeatmap'
import ActivityOverlapCard from '../components/dashboard/ActivityOverlapCard'
import MuscleMapCard, { MUSCLE_PERIOD_DAYS, type MusclePeriod } from '../components/dashboard/MuscleMapCard'
import { PageHeader, StatTile, SectionHeader } from '../components/ui'
import Loading from '../components/Loading'
import { TOOLTIP_STYLE, AXIS_TICK } from '../utils/chartTheme'
import { muscleColorBordered } from '../utils/exerciseUtils'
import * as types from '../types'

function hoursLabel(seconds: number): string {
  const h = seconds / 3600
  return h >= 10 ? Math.round(h).toString() : h.toFixed(1)
}

// A year of lifting runs to hundreds of thousands, which is unreadable as a
// bare integer in a tile this size. Abbreviate past 10k and keep one decimal,
// so 818,275 lb reads as "818k" rather than a wall of digits.
function volumeLabel(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `${Math.round(v / 1000)}k`
  return v.toLocaleString()
}

/**
 * The training record, in one place.
 *
 * Everything here needs to see the user's whole history, which is only possible
 * since the aggregates moved server-side — and it relieves the dashboard, which
 * had grown to eleven cards in a single scroll.
 */
export default function Stats() {
  const { settings } = useSettingsStore()
  const wUnit = weightShort(settings.weight_unit)

  const year = useTrainingStats(365, ['daily', 'streak'])
  const cardio = useCardioStats(365, ['daily', 'streak'], true)
  const [musclePeriod, setMusclePeriod] = useState<MusclePeriod>('month')
  const muscles = useTrainingStats(MUSCLE_PERIOD_DAYS[musclePeriod], ['muscles'])
  const [consistencySource, setConsistencySource] = useState<ConsistencySource>('both')

  const [prs, setPRs] = useState<types.RecentPR[]>([])
  const [selectedExercise, setSelectedExercise] = useState<types.RecentPR | null>(null)
  const [history, setHistory] = useState<types.ExerciseHistoryPoint[]>([])

  useEffect(() => {
    workoutAPI.prs(25).then(list => {
      setPRs(list || [])
      // Lead with the most recent record rather than an empty chart.
      if (list?.length) setSelectedExercise(list[0])
    }).catch(() => setPRs([]))
  }, [])

  useEffect(() => {
    if (!selectedExercise) return
    exerciseAPI.getHistory(selectedExercise.exercise_id, 60)
      .then(h => setHistory(h || []))
      .catch(() => setHistory([]))
  }, [selectedExercise])

  const chartData = useMemo(
    () => [...history].reverse()
      .filter(h => h.best_e1rm > 0)
      .map(h => ({
        date: format(parseISO(h.date.slice(0, 10)), 'M/d'),
        e1rm: displayWeight(h.best_e1rm, wUnit),
      })),
    [history, wUnit],
  )

  const totals = year.stats?.totals
  // The headline streak follows the consistency toggle, so the page shows one
  // coherent number rather than a second, possibly-conflicting streak.
  const streak =
    consistencySource === 'cardio' ? cardio.stats?.streak
      : consistencySource === 'both' ? cardio.stats?.combined_streak
        : year.stats?.streak

  if (year.loading && !year.stats) return <Loading />

  return (
    <div className="space-y-4 animate-slide-up">
      <PageHeader title="Stats" subtitle="Your training record" />

      {/* Headline totals for the trailing year */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Current streak"
          value={streak?.current ?? 0}
          unit={streak?.current === 1 ? 'day' : 'days'}
          sub={`Longest ${streak?.longest ?? 0}`}
          icon={Flame}
          accent="#f59e0b"
        />
        <StatTile
          label="Sessions"
          value={totals?.workouts ?? 0}
          sub={`${totals?.active_days ?? 0} active days`}
          icon={Dumbbell}
          accent="#22d3ee"
        />
        <StatTile
          label="Time trained"
          value={hoursLabel(totals?.duration ?? 0)}
          unit="h"
          sub="past year"
          icon={Clock}
          accent="#a78bfa"
        />
        <StatTile
          label="Volume"
          value={volumeLabel(displayVolume(totals?.volume ?? 0, wUnit))}
          unit={wUnit}
          sub={`${(totals?.sets ?? 0).toLocaleString()} sets`}
          icon={TrendingUp}
          accent="#16a34a"
        />
      </div>

      {/* A full year, shaded by time invested */}
      <ConsistencyHeatmap
        workoutDaily={year.stats?.daily ?? []}
        cardioDaily={cardio.stats?.daily ?? []}
        streak={streak}
        source={consistencySource}
        onSourceChange={setConsistencySource}
        weeks={52}
        metric="duration"
      />

      <ActivityOverlapCard workoutDaily={year.stats?.daily ?? []} cardioDaily={cardio.stats?.daily ?? []} />

      {/* Synced Cardio totals — a distinct data source from any "Cardio" label
          elsewhere on this page (that one classifies exercises logged inside a
          workout; this is the Health Connect import). Same trailing year as
          the headline totals above. */}
      <div className="card p-4">
        <SectionHeader icon={HeartPulse} title="Synced Cardio" className="mb-3" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            label="Sessions"
            value={cardio.stats?.totals.sessions ?? 0}
            sub={`${cardio.stats?.totals.active_days ?? 0} active days`}
            icon={HeartPulse}
            accent="#ef4444"
          />
          <StatTile
            label="Time"
            value={hoursLabel(cardio.stats?.totals.duration ?? 0)}
            unit="h"
            sub="past year"
            icon={Clock}
            accent="#a78bfa"
          />
          <StatTile
            label="Distance"
            value={((cardio.stats?.totals.distance_meters ?? 0) / 1000).toFixed(1)}
            unit="km"
            sub="past year"
            icon={TrendingUp}
            accent="#22d3ee"
          />
          <StatTile
            label="Calories"
            value={Math.round(cardio.stats?.totals.calories ?? 0).toLocaleString()}
            unit="kcal"
            sub="past year"
            icon={Flame}
            accent="#f59e0b"
          />
        </div>
      </div>

      <MuscleMapCard
        muscles={muscles.stats?.muscles ?? []}
        period={musclePeriod}
        onPeriodChange={setMusclePeriod}
        large
      />

      {/* Strength progression for whichever lift is selected below */}
      <div className="card p-4">
        <SectionHeader
          icon={TrendingUp}
          title="Strength progression"
          right={
            selectedExercise && (
              <Link
                to={`/exercises/${selectedExercise.exercise_id}`}
                className="inline-flex items-center gap-1 text-xs text-tx-muted hover:text-tx-secondary transition-colors"
              >
                Exercise <ArrowRight className="w-3 h-3" />
              </Link>
            )
          }
          className="mb-3"
        />
        {!selectedExercise ? (
          <p className="text-xs text-tx-muted py-6 text-center">Log some weighted sets to see progression</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-tx-primary mb-2">{selectedExercise.exercise_name}</p>
            {chartData.length < 2 ? (
              <p className="text-xs text-tx-muted py-6 text-center">
                Not enough sessions yet for a trend
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData}>
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => [`${v} ${wUnit}`, 'Est. 1RM']}
                  />
                  <Line
                    type="monotone"
                    dataKey="e1rm"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: '#a78bfa' }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </div>

      {/* Personal records, newest first — a feed, not a leaderboard */}
      <div className="card p-4">
        <SectionHeader
          icon={Trophy}
          title="Personal records"
          right={<span className="text-xs text-tx-muted">tap to chart</span>}
          className="mb-3"
        />
        {prs.length === 0 ? (
          <p className="text-xs text-tx-muted py-6 text-center">No weighted sets logged yet</p>
        ) : (
          <div className="space-y-1">
            {prs.map(pr => {
              const days = differenceInCalendarDays(new Date(), parseISO(pr.date.slice(0, 10)))
              const active = selectedExercise?.exercise_id === pr.exercise_id
              return (
                <button
                  key={pr.exercise_id}
                  onClick={() => setSelectedExercise(pr)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                    active ? 'bg-brand-500/10 ring-1 ring-brand-500/25' : 'hover:bg-surface-muted/50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-tx-primary truncate">{pr.exercise_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${muscleColorBordered(pr.muscle_group)}`}>
                        {pr.muscle_group}
                      </span>
                      <span className="text-[10px] text-tx-muted">
                        {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-tx-primary tabular-nums">
                      {displayWeight(pr.weight, wUnit)} <span className="text-xs font-normal text-tx-muted">{wUnit} × {pr.reps}</span>
                    </p>
                    <p className="text-[10px] text-tx-muted tabular-nums">
                      {displayWeight(pr.estimated_1rm, wUnit)} est. 1RM
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
