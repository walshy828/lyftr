import { useState, useMemo, useEffect } from 'react'
import { format } from 'date-fns'
import { CalendarRange, Dumbbell, HeartPulse, Flame, Scale } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine, CartesianGrid, Cell,
} from 'recharts'
import { PageHeader, SectionHeader, SegmentedControl, StatTile, DeltaBadge, EmptyState } from '../components/ui'
import { useWeeklySummary } from '../hooks/useWeeklySummary'
import { useSettingsStore, weightShort, displayWeight } from '../stores/settings'
import { weightWaterfall, weekOverWeek, type WeeklySummaryRow } from '../utils/weeklySummary'
import { goalDirection } from '../utils/dashboardMetrics'
import { TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE, CARDIO_HEX, FOCUS_HEX } from '../utils/chartTheme'
import * as types from '../types'
import { weightPlanAPI } from '../services/api'

const PRESETS = [
  { value: '4', label: '4w' },
  { value: '8', label: '8w' },
  { value: '12', label: '12w' },
  { value: '26', label: '26w' },
  { value: '52', label: '52w' },
] as const

const STRENGTH_HEX = FOCUS_HEX.Upper // shares the ACTIVITY_HEX-validated pair with CARDIO_HEX
const GOOD_HEX = '#10b981'
const BAD_HEX = '#ef4444'
const NEUTRAL_HEX = '#6366f1'

function weekLabel(row: WeeklySummaryRow): string {
  return format(row.range.start, 'MMM d')
}

function fmtMinutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtDistance(meters: number, weightUnit: string): string {
  // Distance unit follows the same imperial/metric split as weight, since
  // there's no separate distance-unit setting.
  if (weightUnit === 'kg') return `${(meters / 1000).toFixed(1)} km`
  return `${(meters / 1609.34).toFixed(1)} mi`
}

export default function WeeklySummary() {
  const { settings } = useSettingsStore()
  const wUnit = weightShort(settings.weight_unit)
  const [weeksStr, setWeeksStr] = useState<string>('12')
  const weeks = Number(weeksStr)

  const { rows, loading, error, hasPlan } = useWeeklySummary(weeks, settings.protein_target)
  const deltas = useMemo(() => weekOverWeek(rows), [rows])
  const waterfall = useMemo(() => weightWaterfall(rows), [rows])

  const [goal, setGoal] = useState<types.CurrentNutritionGoal | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!hasPlan) { setGoal(null); return }
    weightPlanAPI.current().then(g => { if (!cancelled) setGoal(g) }).catch(() => { if (!cancelled) setGoal(null) })
    return () => { cancelled = true }
  }, [hasPlan])

  const direction = goal && rows.length && rows[0].weight.start !== null
    ? goalDirection(goal.goal.target_weight, rows[0].weight.start)
    : null
  const weightGoodDir: 'up' | 'down' | 'none' = direction === 'loss' ? 'down' : direction === 'gain' ? 'up' : 'none'

  const waterfallData = waterfall.map((w, i) => ({
    week: weekLabel(rows[i]),
    // Stacked-bar waterfall: an invisible base segment plus a colored delta
    // segment. Re-based to cumulative change since the window start (not
    // absolute weight) so a few pounds of movement isn't swamped by a ~180lb
    // baseline — see weightWaterfall's doc comment.
    base: w.delta === null ? 0 : Math.min(w.base ?? 0, (w.base ?? 0) + w.delta),
    delta: w.delta === null ? 0 : Math.abs(w.delta),
    raw: w.delta,
    up: (w.delta ?? 0) > 0,
    hasData: w.delta !== null,
  }))

  const sessionsData = rows.map(r => ({
    week: weekLabel(r),
    Strength: r.strength.workouts,
    Cardio: r.cardio.sessions,
  }))
  const minutesData = rows.map(r => ({
    week: weekLabel(r),
    Strength: Math.round(r.strength.duration / 60),
    Cardio: Math.round(r.cardio.duration / 60),
  }))

  const totalWeeks = rows.length
  const latest = rows[totalWeeks - 1]
  const latestDelta = deltas[totalWeeks - 1]

  return (
    <div className="page-container space-y-5">
      <PageHeader
        title="Weekly Summary"
        subtitle="How the last few weeks trended, at a glance"
        action={<SegmentedControl options={PRESETS} value={weeksStr} onChange={setWeeksStr} size="sm" />}
      />

      {loading && rows.length === 0 && (
        <div className="text-center text-tx-muted text-sm py-12">Loading…</div>
      )}

      {!loading && error && rows.length === 0 && (
        <EmptyState icon={CalendarRange} title="Couldn't load weekly summary" subtitle={error} />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          {/* Headline tiles for the most recent week */}
          {latest && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatTile
                label="Weight change"
                icon={Scale}
                accent={NEUTRAL_HEX}
                value={latest.weight.change !== null ? Math.abs(displayWeight(latest.weight.change, settings.weight_unit)) : '—'}
                unit={latest.weight.change !== null ? wUnit : undefined}
                sub="this week"
                delta={
                  latest.weight.change !== null
                    ? <DeltaBadge value={displayWeight(latest.weight.change, settings.weight_unit)} goodDirection={weightGoodDir} decimals={1} suffix={` ${wUnit}`} />
                    : undefined
                }
              />
              <StatTile
                label="Strength"
                icon={Dumbbell}
                accent={STRENGTH_HEX}
                value={latest.strength.workouts}
                sub={latest.strength.workouts === 1 ? 'workout' : 'workouts'}
                delta={latestDelta ? <DeltaBadge value={latestDelta.workouts.abs} goodDirection="up" /> : undefined}
              />
              <StatTile
                label="Cardio"
                icon={HeartPulse}
                accent={CARDIO_HEX}
                value={latest.cardio.sessions}
                sub={latest.cardio.sessions === 1 ? 'session' : 'sessions'}
                delta={latestDelta ? <DeltaBadge value={latestDelta.cardioSessions.abs} goodDirection="up" /> : undefined}
              />
              <StatTile
                label="Nutrition"
                icon={Flame}
                accent="#00b8d9"
                value={latest.nutrition.daysLogged > 0 ? Math.round(latest.nutrition.avgCalories).toLocaleString() : '—'}
                unit={latest.nutrition.daysLogged > 0 ? 'kcal' : undefined}
                sub={`${latest.nutrition.daysLogged}/${latest.nutrition.daysInWindow} days logged`}
                delta={latestDelta && latest.nutrition.daysLogged > 0 ? <DeltaBadge value={latestDelta.avgCalories.abs} goodDirection="none" /> : undefined}
              />
            </div>
          )}

          {/* Weight waterfall */}
          <div className="card p-4">
            <SectionHeader icon={Scale} title="Weight change by week" className="mb-3" />
            <p className="text-xs text-tx-muted -mt-2 mb-3">
              Net change ({wUnit}) since the start of this window — each bar is that week's move.
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={waterfallData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="week" tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
                <YAxis
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => displayWeight(v, settings.weight_unit).toFixed(0)}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(_: number, __: string, item: { payload?: { raw?: number | null } }) => {
                    const raw = item?.payload?.raw
                    if (raw === null || raw === undefined) return ['No data', 'Change']
                    const disp = displayWeight(Math.abs(raw), settings.weight_unit)
                    return [`${raw < 0 ? '−' : '+'}${disp.toFixed(1)} ${wUnit}`, 'Change']
                  }}
                  labelFormatter={(l: string) => `Week of ${l}`}
                />
                <ReferenceLine y={0} stroke={GRID_STROKE} />
                <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="delta" stackId="w" radius={[3, 3, 3, 3]} isAnimationActive={false}>
                  {waterfallData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={
                        !d.hasData ? GRID_STROKE
                        : weightGoodDir === 'none' ? NEUTRAL_HEX
                        : (d.up && weightGoodDir === 'up') || (!d.up && weightGoodDir === 'down') ? GOOD_HEX
                        : BAD_HEX
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sessions per week */}
          <div className="card p-4">
            <SectionHeader icon={Dumbbell} title="Sessions per week" className="mb-3" />
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sessionsData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="week" tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l: string) => `Week of ${l}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Strength" fill={STRENGTH_HEX} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Cardio" fill={CARDIO_HEX} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Active minutes per week */}
          <div className="card p-4">
            <SectionHeader icon={HeartPulse} title="Active minutes per week" className="mb-3" />
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={minutesData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="week" tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l: string) => `Week of ${l}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Strength" stackId="m" fill={STRENGTH_HEX} isAnimationActive={false} />
                <Bar dataKey="Cardio" stackId="m" fill={CARDIO_HEX} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Weekly data table */}
          <div className="card p-4 overflow-x-auto">
            <SectionHeader icon={CalendarRange} title="Weekly detail" className="mb-3" />
            <table className="w-full text-xs">
              <thead>
                <tr className="text-tx-muted text-left border-b border-surface-border">
                  <th className="py-1.5 pr-3 font-medium">Week of</th>
                  <th className="py-1.5 pr-3 font-medium">Starting weight</th>
                  <th className="py-1.5 pr-3 font-medium">Weight</th>
                  <th className="py-1.5 pr-3 font-medium">Strength</th>
                  <th className="py-1.5 pr-3 font-medium">Cardio</th>
                  <th className="py-1.5 pr-3 font-medium">Distance</th>
                  <th className="py-1.5 pr-3 font-medium">Avg kcal</th>
                  <th className="py-1.5 pr-3 font-medium">Avg protein</th>
                  <th className="py-1.5 pr-3 font-medium">Logging</th>
                  {hasPlan && <th className="py-1.5 pr-3 font-medium">vs plan</th>}
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((row, ri) => {
                  const i = rows.length - 1 - ri
                  const d = deltas[i]
                  const missedLogging = row.nutrition.daysInWindow - row.nutrition.daysLogged
                  return (
                    <tr key={row.range.start.toISOString()} className="border-b border-surface-border last:border-0">
                      <td className="py-1.5 pr-3 text-tx-primary whitespace-nowrap">{weekLabel(row)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-tx-secondary">
                        {row.weight.start !== null ? `${displayWeight(row.weight.start, settings.weight_unit).toFixed(1)} ${wUnit}` : '—'}
                      </td>
                      <td className="py-1.5 pr-3">
                        {row.weight.change !== null ? (
                          <DeltaBadge
                            value={displayWeight(row.weight.change, settings.weight_unit)}
                            goodDirection={weightGoodDir}
                            decimals={1}
                            suffix={` ${wUnit}`}
                          />
                        ) : <span className="text-tx-muted">—</span>}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {row.strength.workouts} {row.strength.workouts === 1 ? 'wo' : 'wos'}
                        {d && <DeltaBadge value={d.workouts.abs} goodDirection="up" className="ml-1" />}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {row.cardio.sessions} · {fmtMinutes(row.cardio.duration)}
                        {d && <DeltaBadge value={d.cardioSessions.abs} goodDirection="up" className="ml-1" />}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-tx-secondary">
                        {row.cardio.distanceMeters > 0 ? fmtDistance(row.cardio.distanceMeters, settings.weight_unit) : '—'}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {row.nutrition.daysLogged > 0 ? Math.round(row.nutrition.avgCalories).toLocaleString() : '—'}
                        {d && row.nutrition.daysLogged > 0 && <DeltaBadge value={d.avgCalories.abs} goodDirection="none" className="ml-1" />}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {row.nutrition.daysLogged > 0 ? `${Math.round(row.nutrition.avgProtein)}g` : '—'}
                        {d && row.nutrition.daysLogged > 0 && <DeltaBadge value={d.avgProtein.abs} goodDirection="up" className="ml-1" />}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span className={missedLogging <= 1 ? 'text-success-400' : missedLogging >= 4 ? 'text-error-400' : 'text-tx-secondary'}>
                          {row.nutrition.daysLogged}/{row.nutrition.daysInWindow}
                        </span>
                      </td>
                      {hasPlan && (
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {row.plan?.hasActual ? (
                            <DeltaBadge
                              value={displayWeight(row.plan.varianceLbs, settings.weight_unit)}
                              goodDirection={weightGoodDir}
                              decimals={1}
                              suffix={` ${wUnit}`}
                            />
                          ) : <span className="text-tx-muted">—</span>}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
