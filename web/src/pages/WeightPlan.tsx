import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import {
  Target, Sparkles, AlertCircle, Check, TrendingUp, TrendingDown, Flame,
  Utensils, Dumbbell, History, ArrowLeft, ShieldAlert, Gauge, RefreshCw, Info, Calendar,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, CartesianGrid,
} from 'recharts'
import Loading from '../components/Loading'
import PageHeader from '../components/ui/PageHeader'
import SectionHeader from '../components/ui/SectionHeader'
import EmptyState from '../components/ui/EmptyState'
import { profileAPI, weightPlanAPI, weightAPI, userAPI } from '../services/api'
import { useSettingsStore, weightShort, lbsToDisplay, displayWeight } from '../stores/settings'
import * as types from '../types'

const PLAN_COLOR = '#10b981'
const ACTUAL_COLOR = '#6366f1'
// The forecast is a projection of the *actual* trend, not a new series — same
// hue as Actual, dashed and dimmer, reads as "this line continues."
const FORECAST_COLOR = ACTUAL_COLOR

const TOOLTIP_STYLE = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--surface-border)',
  borderRadius: 8,
  fontSize: 11,
  color: 'var(--tx-primary)',
}

// BMI zone band colors (distinct from PLAN_COLOR/ACTUAL_COLOR so they read
// as background context, not additional series).
const ZONE_COLORS = {
  underweight: '#0ea5e9',
  healthy: '#10b981',
  overweight: '#f59e0b',
  obese: '#ef4444',
}

interface ChartRow {
  date: string
  ts: number
  plan?: number
  actual?: number
  forecast?: number
}

interface ChartTooltipProps {
  active?: boolean
  label?: string | number
  payload?: { dataKey?: string; value?: number; color?: string }[]
  wUnit: string
}

function deltaColor(delta: number): string {
  // Below plan (losing faster/weighing less than planned) reads as ahead of
  // a weight-loss goal — success color; above plan reads as behind.
  return delta <= 0 ? 'var(--success-400, #34d399)' : 'var(--amber-400, #fbbf24)'
}

function ChartTooltip({ active, label, payload, wUnit }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const byKey: Record<string, number> = {}
  for (const p of payload) {
    if (p.dataKey && p.value !== undefined) byKey[p.dataKey] = p.value
  }
  const rows: { name: string; value: number; color: string }[] = []
  if (byKey.plan !== undefined) rows.push({ name: 'Plan', value: byKey.plan, color: PLAN_COLOR })
  if (byKey.actual !== undefined) rows.push({ name: 'Actual', value: byKey.actual, color: ACTUAL_COLOR })
  if (byKey.forecast !== undefined) rows.push({ name: 'Forecast', value: byKey.forecast, color: FORECAST_COLOR })

  const deltas: { name: string; value: number }[] = []
  if (byKey.actual !== undefined && byKey.plan !== undefined) {
    deltas.push({ name: 'Actual vs plan', value: byKey.actual - byKey.plan })
  }
  if (byKey.forecast !== undefined && byKey.plan !== undefined) {
    deltas.push({ name: 'Forecast vs plan', value: byKey.forecast - byKey.plan })
  }

  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2">
      <p className="font-medium mb-1">{label ? format(new Date(label), 'MMM d, yyyy') : ''}</p>
      {rows.map(r => (
        <p key={r.name} style={{ color: r.color }}>
          {r.name}: {r.value.toFixed(1)} {wUnit}
        </p>
      ))}
      {deltas.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: 'var(--surface-border)' }}>
          {deltas.map(d => (
            <p key={d.name} style={{ color: deltaColor(d.value) }}>
              {d.name}: {d.value > 0 ? '+' : ''}{d.value.toFixed(1)} {wUnit}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// Linear interpolation across a sorted set of known points — used to fill in
// a sensible plan/forecast value on chart rows that fall between two known
// trajectory points (never extrapolated past the first/last known point).
function interpolateAt(points: { ts: number; val: number }[], ts: number): number | undefined {
  if (points.length === 0) return undefined
  if (ts <= points[0].ts) return ts === points[0].ts ? points[0].val : undefined
  const last = points[points.length - 1]
  if (ts >= last.ts) return ts === last.ts ? last.val : undefined
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (ts >= a.ts && ts <= b.ts) {
      if (b.ts === a.ts) return a.val
      const frac = (ts - a.ts) / (b.ts - a.ts)
      return a.val + (b.val - a.val) * frac
    }
  }
  return undefined
}

export default function WeightPlan() {
  const { settings } = useSettingsStore()
  const wUnit = weightShort(settings.weight_unit)

  const [profile, setProfile] = useState<types.ProfileWithBMI | null>(null)
  const [current, setCurrent] = useState<types.CurrentNutritionGoal | null>(null)
  const [history, setHistory] = useState<types.NutritionGoal[]>([])
  const [adherence, setAdherence] = useState<types.WeightPlanAdherence | null>(null)
  const [actualLogs, setActualLogs] = useState<types.WeightLog[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingAdherence, setRefreshingAdherence] = useState(false)

  const [targetWeight, setTargetWeight] = useState('')
  const [timeframeWeeks, setTimeframeWeeks] = useState('')
  const [draft, setDraft] = useState<types.DraftWeightPlan | null>(null)
  const [generating, setGenerating] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAll = async () => {
    const [p, logs] = await Promise.all([
      profileAPI.get().catch(() => null),
      weightAPI.list({ limit: 200 }).catch(() => []),
    ])
    setProfile(p)
    setActualLogs(logs || [])
    try {
      const c = await weightPlanAPI.current()
      setCurrent(c)
    } catch {
      setCurrent(null)
    }
    weightPlanAPI.history().then(setHistory).catch(() => {})
  }

  useEffect(() => {
    setLoading(true)
    loadAll().finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!current) { setAdherence(null); return }
    weightPlanAPI.adherence().then(setAdherence).catch(() => setAdherence(null))
  }, [current])

  const handleRefreshAdherence = async () => {
    setRefreshingAdherence(true)
    try {
      const a = await weightPlanAPI.adherence(true)
      setAdherence(a)
    } catch {
      // leave the existing adherence data in place on failure
    } finally {
      setRefreshingAdherence(false)
    }
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = parseFloat(targetWeight)
    if (!(t > 0)) {
      setError('Enter a target weight')
      return
    }
    setGenerating(true)
    setError(null)
    setDraft(null)
    try {
      const plan = await weightPlanAPI.generate({
        target_weight: settings.weight_unit === 'lbs' ? t : t / 0.453592,
        timeframe_weeks: timeframeWeeks ? parseInt(timeframeWeeks) : undefined,
      })
      setDraft(plan)
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not generate a plan — try again')
    } finally {
      setGenerating(false)
    }
  }

  const handleAccept = async () => {
    if (!draft) return
    setAccepting(true)
    setError(null)
    try {
      const t = parseFloat(targetWeight)
      const targetLbs = settings.weight_unit === 'lbs' ? t : t / 0.453592
      await weightPlanAPI.accept({
        calorie_target: draft.calorie_target,
        protein_target: draft.protein_target,
        carb_target: draft.carb_target,
        fat_target: draft.fat_target,
        target_weight: targetLbs,
        notes: [draft.rationale, draft.safety_notes].filter(Boolean).join(' '),
        weekly_trajectory: draft.weekly_trajectory,
      })
      setDraft(null)
      setTargetWeight('')
      // fetch() is a no-op once settings are already loaded — accepting a
      // plan changed the server's targets underneath the cached store, so
      // pull the fresh row directly rather than relying on the guarded fetch.
      const freshSettings = await userAPI.getSettings()
      useSettingsStore.setState(state => ({ settings: { ...state.settings, ...freshSettings } }))
      await loadAll()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not save this plan — try again')
    } finally {
      setAccepting(false)
    }
  }

  const chartData: ChartRow[] = useMemo(() => {
    const rows = new Map<string, ChartRow>()
    const planPoints: { ts: number; val: number }[] = []
    const forecastPoints: { ts: number; val: number }[] = []
    if (current) {
      for (const p of current.plan_timeline) {
        const d = p.expected_date ? p.expected_date.slice(0, 10) : ''
        if (!d) continue
        const ts = new Date(d).getTime()
        const val = lbsToDisplay(p.expected_weight, settings.weight_unit)
        planPoints.push({ ts, val })
        rows.set(d, { ...(rows.get(d) ?? { date: d, ts }), date: d, ts, plan: val })
      }
      for (const p of current.actual_forecast) {
        const d = p.expected_date ? p.expected_date.slice(0, 10) : ''
        if (!d) continue
        const ts = new Date(d).getTime()
        const val = lbsToDisplay(p.expected_weight, settings.weight_unit)
        forecastPoints.push({ ts, val })
        rows.set(d, { ...(rows.get(d) ?? { date: d, ts }), date: d, ts, forecast: val })
      }
    }
    for (const l of actualLogs) {
      const d = l.logged_at.slice(0, 10)
      const ts = new Date(d).getTime()
      rows.set(d, { ...(rows.get(d) ?? { date: d, ts }), date: d, ts, actual: lbsToDisplay(l.weight, settings.weight_unit) })
    }
    planPoints.sort((a, b) => a.ts - b.ts)
    forecastPoints.sort((a, b) => a.ts - b.ts)
    // Fill in interpolated plan/forecast values on every row so hovering any
    // actual-only date still shows a sensible plan/forecast comparison.
    for (const row of rows.values()) {
      if (row.plan === undefined) {
        const v = interpolateAt(planPoints, row.ts)
        if (v !== undefined) row.plan = v
      }
      if (row.forecast === undefined) {
        const v = interpolateAt(forecastPoints, row.ts)
        if (v !== undefined) row.forecast = v
      }
    }
    return Array.from(rows.values()).sort((a, b) => a.ts - b.ts)
  }, [current, actualLogs, settings.weight_unit])

  // Client-computed pace evaluation (#6): average lbs/week the accepted
  // plan's own projections imply, compared against the BMI-based safe-pace
  // guidance already fetched for the profile. Purely informational — the
  // plan is already AI-constrained to sane bounds at generation time.
  const planPace = useMemo(() => {
    if (!current || current.projections.length < 2 || !profile?.bmi) return null
    const pts = current.projections
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (first.week === last.week) return null
    const weeks = last.week - first.week
    const avgPerWeek = (first.expected_weight - last.expected_weight) / weeks
    const guidance = profile.bmi.loss_guidance
    const inRange = guidance.high_lbs_per_week <= 0
      ? true // no guidance available (e.g. underweight/unknown) — nothing to flag
      : Math.abs(avgPerWeek) <= guidance.high_lbs_per_week * 1.15 // small headroom for early-phase tapering
    return { avgPerWeek, guidance, inRange }
  }, [current, profile])

  // BMI zone boundaries in the user's display unit, derived from the
  // server-computed lbs boundaries (utils.BMICategory's 18.5/25/30
  // thresholds) — never re-declared here, just converted for display.
  const bmiZones = useMemo(() => {
    const b = profile?.bmi
    if (!b || b.bmi <= 0) return null
    const unit = settings.weight_unit
    const lowDisp = lbsToDisplay(b.healthy_range_low, unit)
    const highDisp = lbsToDisplay(b.healthy_range_high, unit)
    const obeseDisp = lbsToDisplay(b.obese_min_lbs, unit)
    return [
      { key: 'underweight', label: 'Underweight', rangeText: `< ${Math.round(lowDisp)}`, y1: -1000, y2: lowDisp, color: ZONE_COLORS.underweight },
      { key: 'healthy', label: 'Healthy', rangeText: `${Math.round(lowDisp)}–${Math.round(highDisp)}`, y1: lowDisp, y2: highDisp, color: ZONE_COLORS.healthy },
      { key: 'overweight', label: 'Overweight', rangeText: `${Math.round(highDisp)}–${Math.round(obeseDisp)}`, y1: highDisp, y2: obeseDisp, color: ZONE_COLORS.overweight },
      { key: 'obese', label: 'Obese', rangeText: `≥ ${Math.round(obeseDisp)}`, y1: obeseDisp, y2: obeseDisp + 1000, color: ZONE_COLORS.obese },
    ] as const
  }, [profile?.bmi, settings.weight_unit])

  if (loading) return <Loading />

  const bmi = profile?.bmi
  const hasProfile = !!profile && profile.height_inches > 0

  return (
    <div className="space-y-5 animate-slide-up">
      <PageHeader
        title="Weight-Loss Plan"
        subtitle="AI-generated nutrition targets and weekly trajectory"
        action={
          <Link to="/weight" className="btn-secondary btn-sm">
            <ArrowLeft className="w-3.5 h-3.5" /> Weight
          </Link>
        }
      />

      {error && (
        <div className="alert-error" role="alert">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!hasProfile && (
        <div className="card p-5 border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-tx-primary">Complete your profile first</p>
              <p className="text-xs text-tx-muted mt-1">Age, sex, height, and activity level are needed to generate a plan and compute BMI.</p>
              <Link to="/settings" className="btn-primary btn-sm mt-3 inline-flex">Go to Settings</Link>
            </div>
          </div>
        </div>
      )}

      {/* BMI readout + pace guidance */}
      {hasProfile && bmi && bmi.bmi > 0 && (
        <div className="card p-5">
          <SectionHeader icon={Target} title="Your BMI" />
          <div className="flex items-end gap-3 mt-3">
            <span className="stat-value text-4xl">{bmi.bmi.toFixed(1)}</span>
            <span className="text-sm text-tx-muted capitalize mb-1">{bmi.category}</span>
          </div>
          {bmiZones && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {bmiZones.map(z => (
                <div
                  key={z.key}
                  className={`rounded-lg p-2 text-center border ${
                    z.key === bmi.category
                      ? 'border-brand-400 bg-brand-500/10'
                      : 'border-surface-border bg-surface-overlay'
                  }`}
                >
                  <p className="text-[10px] uppercase text-tx-muted">{z.label}</p>
                  <p className="text-xs font-medium text-tx-primary mt-0.5">{z.rangeText} {wUnit}</p>
                </div>
              ))}
            </div>
          )}
          {bmi.loss_guidance.high_lbs_per_week > 0 && (
            <div className="flex items-start gap-2 text-xs text-tx-secondary bg-surface-overlay border border-surface-border rounded-lg p-3 mt-3">
              <Gauge className="w-3.5 h-3.5 text-brand-400 flex-shrink-0 mt-0.5" />
              <span>
                <strong className="text-tx-primary">Recommended pace: {bmi.loss_guidance.low_lbs_per_week.toFixed(1)}–{bmi.loss_guidance.high_lbs_per_week.toFixed(1)} lbs/week.</strong> {bmi.loss_guidance.note}
              </span>
            </div>
          )}
          {bmi.loss_guidance.high_lbs_per_week === 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-3">
              <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{bmi.loss_guidance.note}</span>
            </div>
          )}
        </div>
      )}

      {/* Generate plan */}
      <div id="generate-plan" className="card p-5 scroll-mt-4">
        <SectionHeader icon={Sparkles} title="Generate a Plan" />
        <form onSubmit={handleGenerate} className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1">Target weight ({wUnit})</label>
              <input
                type="number"
                value={targetWeight}
                onChange={e => setTargetWeight(e.target.value)}
                className="input w-full"
                min={1}
                placeholder="e.g. 190"
              />
            </div>
            <div>
              <label className="label mb-1">Timeframe (weeks, optional)</label>
              <input
                type="number"
                value={timeframeWeeks}
                onChange={e => setTimeframeWeeks(e.target.value)}
                className="input w-full"
                min={1}
                placeholder="e.g. 16"
              />
            </div>
          </div>
          <button type="submit" disabled={generating || !hasProfile} className="btn-primary btn-md w-full">
            <Sparkles className="w-4 h-4" /> {generating ? 'Generating…' : 'Generate Plan'}
          </button>
        </form>

        {draft && (
          <div className="mt-4 space-y-3 border-t border-surface-border pt-4">
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Calories', value: draft.calorie_target, unit: 'kcal' },
                { label: 'Protein', value: draft.protein_target, unit: 'g' },
                { label: 'Carbs', value: draft.carb_target, unit: 'g' },
                { label: 'Fat', value: draft.fat_target, unit: 'g' },
              ].map(m => (
                <div key={m.label} className="card p-3 text-center">
                  <p className="stat-label">{m.label}</p>
                  <p className="stat-value text-lg mt-1">{m.value}</p>
                  <p className="text-[10px] text-tx-muted">{m.unit}</p>
                </div>
              ))}
            </div>
            {draft.rationale && <p className="text-sm text-tx-secondary">{draft.rationale}</p>}
            {draft.safety_notes && (
              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{draft.safety_notes}</span>
              </div>
            )}
            <button onClick={handleAccept} disabled={accepting} className="btn-primary btn-md w-full">
              <Check className="w-4 h-4" /> {accepting ? 'Saving…' : 'Accept & Import to Settings'}
            </button>
          </div>
        )}

        {!hasProfile && (
          <p className="text-xs text-tx-muted mt-3">Set your profile in Settings before generating a plan.</p>
        )}
      </div>

      {/* Regenerate prompt (#1): a stale/expired/diverging plan */}
      {current && adherence?.should_regenerate && (
        <div className="card p-5 border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-tx-primary">Time to regenerate your plan</p>
              <p className="text-xs text-tx-muted mt-1">{adherence.regenerate_reason}</p>
              <a href="#generate-plan" className="btn-primary btn-sm mt-3 inline-flex">
                <Sparkles className="w-3.5 h-3.5" /> Generate a new plan
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Actual vs plan chart */}
      {current && (
        <div className="card p-5">
          <SectionHeader icon={TrendingDown} title="Actual vs. Plan" />
          {chartData.length < 2 ? (
            <div className="flex items-center justify-center h-40 text-tx-muted text-sm">Not enough data yet</div>
          ) : (
            <div className="h-56 mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="4 4" stroke="var(--surface-border)" opacity={0.3} />
                  <XAxis dataKey="date" tickFormatter={d => format(new Date(d), 'MMM d')} fontSize={11} stroke="var(--tx-secondary)" />
                  <YAxis fontSize={11} stroke="var(--tx-secondary)" domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTooltip wUnit={wUnit} />} />
                  {bmiZones?.map(z => (
                    <ReferenceArea
                      key={z.key}
                      y1={z.y1}
                      y2={z.y2}
                      fill={z.color}
                      fillOpacity={0.08}
                      stroke="none"
                      label={{ value: z.label, position: 'insideTopLeft', fontSize: 10, fill: z.color }}
                    />
                  ))}
                  <ReferenceLine y={lbsToDisplay(current.goal.target_weight, settings.weight_unit)} stroke={PLAN_COLOR} strokeDasharray="3 3" opacity={0.5} />
                  <Line type="monotone" dataKey="plan" name={`Plan (${wUnit})`} stroke={PLAN_COLOR} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="actual" name={`Actual (${wUnit})`} stroke={ACTUAL_COLOR} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="forecast" name={`Forecast (${wUnit})`} stroke={FORECAST_COLOR} strokeOpacity={0.55} strokeDasharray="5 5" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Plan summary write-up (#5, #6, #8): explains the chart in plain language */}
      {current && (
        <div className="card p-5">
          <SectionHeader icon={Info} title="Plan Summary" />
          <div className="space-y-3 mt-3">
            <div className="flex items-start gap-2 text-xs text-tx-secondary">
              <Calendar className="w-3.5 h-3.5 text-tx-muted flex-shrink-0 mt-0.5" />
              <span>
                Active since {format(new Date(current.goal.effective_at), 'MMM d, yyyy')}
                {current.projections.length > 0 && (
                  <> · runs through {format(new Date(current.projections[current.projections.length - 1].expected_date ?? current.goal.effective_at), 'MMM d, yyyy')}</>
                )} · target {displayWeight(current.goal.target_weight, settings.weight_unit)} {wUnit}
              </span>
            </div>

            {current.goal.notes && <p className="text-sm text-tx-secondary">{current.goal.notes}</p>}

            {planPace && (
              <div className={`flex items-start gap-2 text-xs rounded-lg p-3 border ${planPace.inRange ? 'text-tx-secondary bg-surface-overlay border-surface-border' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
                <Gauge className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  This plan averages about {Math.abs(planPace.avgPerWeek).toFixed(1)} lbs/week.{' '}
                  {planPace.inRange
                    ? 'That’s within your recommended pace.'
                    : `That's faster than the ${planPace.guidance.low_lbs_per_week.toFixed(1)}–${planPace.guidance.high_lbs_per_week.toFixed(1)} lbs/week generally recommended for your BMI — worth a second look.`}
                </span>
              </div>
            )}

            <p className="text-xs text-tx-muted">
              Regenerate your plan once it reaches its target date, or sooner if your actual trend keeps drifting from the plan line above — the app will flag it here when that happens.
            </p>
          </div>
        </div>
      )}

      {/* Adherence / motivation */}
      {current && adherence && (
        <div className="card p-5">
          <SectionHeader
            icon={Flame}
            title="Adherence"
            right={
              <div className="flex items-center gap-2">
                <span className={`badge ${adherence.behind_plan ? 'bg-error-500/10 border border-error-500/20 text-error-400' : 'bg-success-500/10 border border-success-500/20 text-success-400'}`}>
                  {adherence.behind_plan ? 'Behind plan' : 'On track'}
                </span>
                <button
                  onClick={handleRefreshAdherence}
                  disabled={refreshingAdherence}
                  className="btn-secondary btn-sm"
                  aria-label="Refresh adherence tip"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingAdherence ? 'animate-spin' : ''}`} />
                </button>
              </div>
            }
          />
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="card p-3 text-center">
              <Utensils className="w-3.5 h-3.5 text-brand-400 mx-auto mb-1" />
              <p className="stat-value text-lg">{adherence.days_logged_food}/7</p>
              <p className="text-[10px] text-tx-muted">days logged</p>
            </div>
            <div className="card p-3 text-center">
              <Flame className="w-3.5 h-3.5 text-amber-400 mx-auto mb-1" />
              <p className="stat-value text-lg">{Math.round(adherence.avg_calories)}</p>
              <p className="text-[10px] text-tx-muted">avg kcal/day</p>
            </div>
            <div className="card p-3 text-center">
              <Dumbbell className="w-3.5 h-3.5 text-success-400 mx-auto mb-1" />
              <p className="stat-value text-lg">{adherence.workouts_last_7d}</p>
              <p className="text-[10px] text-tx-muted">workout days</p>
            </div>
          </div>

          {adherence.drivers.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {adherence.drivers.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-tx-secondary">
                  <span className="w-1 h-1 rounded-full bg-tx-muted mt-1.5 flex-shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
          )}

          {adherence.motivational_note && (
            <div className="mt-4 flex items-start gap-2 text-sm text-tx-primary bg-brand-500/10 border border-brand-500/20 rounded-lg p-3">
              <TrendingUp className="w-4 h-4 text-brand-400 flex-shrink-0 mt-0.5" />
              <span>{adherence.motivational_note}</span>
            </div>
          )}
        </div>
      )}

      {/* Nutrition goal history */}
      <div className="card p-5">
        <SectionHeader icon={History} title="Nutrition Goal History" />
        {history.length === 0 ? (
          <EmptyState icon={History} title="No plans yet" subtitle="Generate and accept a plan to start tracking history" compact />
        ) : (
          <div className="space-y-2 mt-3">
            {history.map(g => (
              <div key={g.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-overlay border border-surface-border">
                <div>
                  <p className="text-sm font-medium text-tx-primary">
                    {g.calorie_target} kcal · {g.protein_target}p / {g.carb_target}c / {g.fat_target}f
                  </p>
                  <p className="text-xs text-tx-muted mt-0.5">{format(new Date(g.effective_at), 'MMM d, yyyy')} · target {displayWeight(g.target_weight, settings.weight_unit)} {wUnit}</p>
                </div>
                <span className="badge-dim uppercase">{g.source}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
