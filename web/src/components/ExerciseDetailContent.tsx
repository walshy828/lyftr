import { useState, useEffect, useMemo } from 'react'
import { Trophy, SquarePlay, Dumbbell, Sparkles } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import Model, { IExerciseData } from 'react-body-highlighter'
import { exerciseAPI } from '../services/api'
import { useSettingsStore, weightShort, displayWeight } from '../stores/settings'
import { useTheme } from '../hooks/useTheme'
import PeriodSelector from './PeriodSelector'
import ExerciseDemo from './exercise/ExerciseDemo'
import { hasExerciseImage } from '../utils/exerciseMedia'
import * as types from '../types'
import { muscleColor, muscleColorBordered, EQUIPMENT_LABEL, muscleToBodySlugs } from '../utils/exerciseUtils'

const HISTORY_PERIODS = ['1m', '3m', '6m', 'All'] as const
type HistoryPeriod = typeof HISTORY_PERIODS[number]
const HISTORY_DAYS: Record<HistoryPeriod, number | null> = { '1m': 30, '3m': 90, '6m': 180, 'All': null }

function buildBodyData(exercise: types.Exercise): IExerciseData[] {
  const primarySlugs = muscleToBodySlugs(exercise.muscle_group)
  const secondarySlugs = (exercise.secondary_muscles || [])
    .flatMap(m => muscleToBodySlugs(m))
    .filter(s => !primarySlugs.includes(s))

  const data: IExerciseData[] = []
  if (primarySlugs.length > 0) {
    data.push({ name: 'Primary', muscles: primarySlugs as any, frequency: 2 })
  }
  if (secondarySlugs.length > 0) {
    data.push({ name: 'Secondary', muscles: secondarySlugs as any, frequency: 1 })
  }
  return data
}

interface Props {
  exercise: types.Exercise
}

export default function ExerciseDetailContent({ exercise }: Props) {
  const { isDark } = useTheme()
  const { settings } = useSettingsStore()
  const wUnit = weightShort(settings.weight_unit)
  const [pr, setPR] = useState<types.PersonalRecord | null>(null)
  const [history, setHistory] = useState<types.ExerciseHistoryPoint[]>([])
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('3m')

  useEffect(() => {
    setPR(null)
    setHistory([])
    Promise.all([
      exerciseAPI.getPRs(exercise.id).catch(() => null),
      exerciseAPI.getHistory(exercise.id, 50).catch(() => []),
    ]).then(([prData, histData]) => {
      setPR(prData)
      setHistory(histData || [])
    })
  }, [exercise.id])

  const filteredHistory = useMemo(() => {
    const days = HISTORY_DAYS[historyPeriod]
    if (days == null) return history
    const cutoff = subDays(new Date(), days).getTime()
    return history.filter(h => new Date(h.date).getTime() >= cutoff)
  }, [history, historyPeriod])

  const bodyColor = isDark ? '#162240' : '#e2e8f0'
  const highlightColors = ['#0e7490', '#22d3ee'] // [secondary=cyan-700, primary=cyan-400]

  const bodyData = buildBodyData(exercise)
  const equipLabel = EQUIPMENT_LABEL[exercise.equipment?.toLowerCase()] || exercise.equipment

  // The seed data has two shapes for `description`: free-exercise-db already
  // numbers each step on its own line ("1. ...\n2. ..."), while the
  // gymvisual source stores one unbroken paragraph with no line breaks at
  // all. Numbered lines are used as-is; a single unbroken blob is split into
  // sentences so it still renders as a step list instead of a wall of text.
  const instructionSteps = useMemo(() => {
    if (!exercise.description) return []
    const lines = exercise.description.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length > 1) return lines.map(l => l.replace(/^\d+\.\s*/, ''))
    const sentences = lines[0]?.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(s => s.trim()).filter(Boolean) || []
    return sentences.length > 1 ? sentences : lines
  }, [exercise.description])

  return (
    <div className="space-y-5">
      {/* Movement demo — crossfades the start and end positions when the
          library has both frames, otherwise shows whichever one exists.
          Matted on white regardless of theme since the source art is
          white-background line art, and given room to breathe edge-to-edge
          with the rest of the page content. */}
      {hasExerciseImage(exercise, 'start') && (
        <ExerciseDemo exercise={exercise} className="w-full h-72 rounded-2xl" />
      )}

      {/* Tags: primary muscle, equipment, and secondary muscles together */}
      <div className="flex flex-wrap gap-2">
        {exercise.source === 'custom' && (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-xs font-medium text-brand-400">
            <Sparkles className="w-3 h-3" /> Custom
          </span>
        )}
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${muscleColorBordered(exercise.muscle_group)}`}>
          {exercise.muscle_group}
        </span>
        {equipLabel && exercise.equipment !== 'other' && (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-muted border border-surface-border text-xs font-medium text-tx-secondary">
            <Dumbbell className="w-3 h-3" />
            {equipLabel}
          </span>
        )}
        {exercise.category && (
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-xs font-medium text-brand-400 capitalize">
            {exercise.category}
          </span>
        )}
        {exercise.secondary_muscles?.map(m => (
          <span key={m} className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${muscleColor(m)}`}>
            {m}
          </span>
        ))}
      </div>

      {/* Instructions */}
      {instructionSteps.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider mb-3">Instructions</p>
          <ol className="space-y-3">
            {instructionSteps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-500/15 text-brand-400 text-[11px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-tx-secondary leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Watch on YouTube */}
      <a
        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${exercise.name} exercise form`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full py-3 bg-surface-muted/60 hover:bg-surface-muted border border-surface-border hover:border-brand-500/40 rounded-2xl text-sm font-medium text-tx-secondary hover:text-brand-400 transition-colors flex items-center justify-center gap-2"
      >
        <SquarePlay className="w-4 h-4" />
        Watch on YouTube
      </a>

      {/* Personal Record */}
      {pr && pr.weight > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-warning-400" />
            <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider">Your Best</p>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-tx-primary tabular-nums">{displayWeight(pr.weight, wUnit)}</span>
            <span className="text-sm text-tx-muted mb-0.5">{wUnit} × {pr.reps} reps</span>
          </div>
          <p className="text-xs text-tx-muted mt-1">
            Est. 1RM: {displayWeight(pr.estimated_1rm, wUnit)} {wUnit} · {format(new Date(pr.date), 'MMM d, yyyy')}
          </p>
        </div>
      )}

      {/* History chart */}
      {history.length >= 2 && (() => {
        const chartData = [...filteredHistory].reverse().map(h => ({
          date: format(new Date(h.date), 'M/d'),
          weight: displayWeight(h.max_weight, wUnit),
          e1rm: h.best_e1rm > 0 ? displayWeight(h.best_e1rm, wUnit) : null,
        }))
        // Bodyweight and cardio work has no load to extrapolate, so the server
        // sends 0 — plotting that would draw a flat line along the axis and
        // imply the lifter is making no progress.
        const hasE1RM = chartData.some(d => d.e1rm !== null)
        return (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3 gap-2">
              <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider">
                {hasE1RM ? 'Strength Progression' : 'Weight Progression'}
              </p>
              <PeriodSelector options={HISTORY_PERIODS} value={historyPeriod} onChange={setHistoryPeriod} />
            </div>
            {hasE1RM && (
              <div className="flex items-center gap-3 mb-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] text-tx-muted">
                  <span className="w-2.5 h-0.5 rounded-full" style={{ background: '#0891b2' }} />
                  Max weight
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] text-tx-muted">
                  <span className="w-2.5 h-0.5 rounded-full" style={{ background: '#a78bfa' }} />
                  Est. 1RM
                </span>
              </div>
            )}
            {chartData.length < 2 ? (
              <div className="flex items-center justify-center h-[110px] text-tx-muted text-sm">No data for this period</div>
            ) : (
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={chartData}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'var(--color-tx-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-raised)',
                    border: '1px solid var(--color-surface-border)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(v: number, name: string) => [
                    `${v} ${wUnit}`,
                    name === 'e1rm' ? 'Est. 1RM' : 'Max weight',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#0891b2"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#0891b2' }}
                  activeDot={{ r: 4 }}
                />
                {/* Estimated 1RM tells the story max weight can't: working a rep
                    range at a fixed load looks flat on max weight, but is real
                    progress. connectNulls keeps a bodyweight session from
                    breaking the line. */}
                {hasE1RM && (
                  <Line
                    type="monotone"
                    dataKey="e1rm"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={{ r: 2.5, fill: '#a78bfa' }}
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
            )}
          </div>
        )
      })()}

      {/* Muscle diagram */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider mb-3">Muscles Worked</p>

        <div className="flex items-start justify-center gap-6">
          <div className="flex flex-col items-center gap-1">
            <Model
              data={bodyData}
              type="anterior"
              bodyColor={bodyColor}
              highlightedColors={highlightColors}
              style={{ width: '140px' }}
            />
            <span className="text-xs text-tx-muted">Front</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Model
              data={bodyData}
              type="posterior"
              bodyColor={bodyColor}
              highlightedColors={highlightColors}
              style={{ width: '140px' }}
            />
            <span className="text-xs text-tx-muted">Back</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 justify-center">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#22d3ee' }} />
            <span className="text-xs text-tx-muted">Primary</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#0e7490' }} />
            <span className="text-xs text-tx-muted">Secondary</span>
          </div>
        </div>
      </div>
    </div>
  )
}
