import { Link } from 'react-router-dom'
import { Scale, Plus, ArrowRight } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import { SectionHeader } from '../ui'
import * as types from '../../types'
import { displayWeight, weightShort, lbsToDisplay } from '../../stores/settings'
import { weightSeries, olsTrend } from '../../utils/dashboardMetrics'
import { TOOLTIP_STYLE, AXIS_TICK, ACTUAL_COLOR, PLAN_COLOR, ZONE_COLORS } from '../../utils/chartTheme'

interface Row { date: string; ts: number; actual?: number; trend?: number }

// "Which way is my weight actually heading, vs my goal and the healthy range?"
// Actual points + a trend/forecast line, a goal line + BMI-zone bands for
// context. The card doubles as the quick weigh-in entry point.
export default function WeightTrendCard({
  weightLogs, weightStats, settings, profile, plan, onLog,
}: {
  weightLogs: types.WeightLog[]
  weightStats: types.WeightStats | null
  settings: types.UserSettings
  profile: types.ProfileWithBMI | null
  plan: types.CurrentNutritionGoal | null
  onLog: () => void
}) {
  const unit = settings.weight_unit
  const wUnit = weightShort(unit)

  // Build the actual series (ascending).
  const series = weightSeries(weightLogs)
  const rows: Row[] = series.map(p => ({
    date: format(new Date(p.ts), 'M/d'),
    ts: p.ts,
    actual: displayWeight(p.weight, unit),
  }))

  // Trend line: prefer the server's clamped forecast when a plan is active,
  // else fit a client-side OLS trend across the logged points.
  if (rows.length >= 2) {
    const t = olsTrend(series)
    if (t) {
      rows[0].trend = displayWeight(t.firstVal, unit)
      rows[rows.length - 1].trend = displayWeight(t.lastVal, unit)
    }
  }

  // BMI zone bands (background context) in display units.
  const bmi = profile?.bmi
  const zones = bmi && bmi.bmi > 0 ? (() => {
    const low = lbsToDisplay(bmi.healthy_range_low, unit)
    const high = lbsToDisplay(bmi.healthy_range_high, unit)
    const obese = lbsToDisplay(bmi.obese_min_lbs, unit)
    return [
      { key: 'underweight', y1: -1e4, y2: low, color: ZONE_COLORS.underweight },
      { key: 'healthy', y1: low, y2: high, color: ZONE_COLORS.healthy },
      { key: 'overweight', y1: high, y2: obese, color: ZONE_COLORS.overweight },
      { key: 'obese', y1: obese, y2: 1e4, color: ZONE_COLORS.obese },
    ]
  })() : null

  const goalDisp = plan ? displayWeight(plan.goal.target_weight, unit) : null
  const change7d = weightStats?.change_7d ?? 0
  const change7dDisp = displayWeight(Math.abs(change7d), unit)

  return (
    <div className="card p-4">
      <SectionHeader
        icon={Scale}
        title="Weight Trend"
        right={
          <Link to="/weight" className="text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-0.5">
            View <ArrowRight className="w-3 h-3" />
          </Link>
        }
        className="mb-2"
      />

      {weightLogs.length === 0 ? (
        <button
          type="button"
          onClick={onLog}
          className="w-full flex items-center gap-3 p-3 bg-brand-500/5 border border-dashed border-brand-500/30 rounded-xl hover:bg-brand-500/10 transition-colors text-left"
        >
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
            <Plus className="w-4 h-4 text-brand-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-tx-primary">Log your first weight</p>
            <p className="text-xs text-tx-muted">Tap to start tracking your trend</p>
          </div>
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-tx-primary tabular-nums leading-none">
                {displayWeight(weightLogs[0].weight, unit)}
              </span>
              <span className="text-sm text-tx-muted">{wUnit}</span>
              {change7d !== 0 && (
                <span className={`text-xs tabular-nums ml-1 ${change7d < 0 ? 'text-success-400' : 'text-error-400'}`}>
                  {change7d < 0 ? '↓' : '↑'}{change7dDisp} {wUnit} · 7d
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onLog}
              className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white shadow-sm flex-shrink-0 active:scale-95 transition-transform"
              aria-label="Log weight"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {rows.length >= 2 ? (
            <div className="w-full min-w-0">
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  {zones?.map(z => (
                    <ReferenceArea key={z.key} y1={z.y1} y2={z.y2} fill={z.color} fillOpacity={0.06} stroke="none" ifOverflow="hidden" />
                  ))}
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
                  {goalDisp !== null && (
                    <ReferenceLine y={goalDisp} stroke={PLAN_COLOR} strokeDasharray="4 4" strokeOpacity={0.7}
                      label={{ value: `Goal ${goalDisp}`, position: 'insideBottomRight', fontSize: 9, fill: PLAN_COLOR }} />
                  )}
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number, name: string) => [`${v} ${wUnit}`, name === 'trend' ? 'Trend' : 'Weight']}
                  />
                  <Line dataKey="trend" name="trend" stroke={ACTUAL_COLOR} strokeOpacity={0.5} strokeDasharray="5 5" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line dataKey="actual" name="actual" stroke={ACTUAL_COLOR} strokeWidth={2} dot={{ r: 2 }} connectNulls type="monotone" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              {zones && (
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
                  {(['healthy', 'overweight', 'obese'] as const).map(k => (
                    <div key={k} className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: ZONE_COLORS[k], opacity: 0.5 }} />
                      <span className="text-[10px] text-tx-muted capitalize">{k}</span>
                    </div>
                  ))}
                  {bmi && bmi.bmi > 0 && <span className="text-[10px] text-tx-muted ml-auto">BMI {bmi.bmi.toFixed(1)}</span>}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-tx-muted py-4 text-center">Log another weight to see your trend</p>
          )}
        </>
      )}
    </div>
  )
}
