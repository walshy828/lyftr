import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import {
  Target, Sparkles, AlertCircle, Check, TrendingUp, TrendingDown, Flame,
  Utensils, Dumbbell, History, ArrowLeft, ShieldAlert, Gauge,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import Loading from '../components/Loading'
import PageHeader from '../components/ui/PageHeader'
import SectionHeader from '../components/ui/SectionHeader'
import EmptyState from '../components/ui/EmptyState'
import { profileAPI, weightPlanAPI, weightAPI, userAPI } from '../services/api'
import { useSettingsStore, weightShort, lbsToDisplay, displayWeight } from '../stores/settings'
import * as types from '../types'

const EXPECTED_COLOR = '#10b981'
const ACTUAL_COLOR = '#6366f1'

const TOOLTIP_STYLE = {
  background: 'var(--color-surface-raised, #1e1e2e)',
  border: '1px solid var(--color-surface-border, #2d2d3a)',
  borderRadius: 8,
  fontSize: 11,
  color: 'var(--color-tx-primary, #f1f5f9)',
}

interface ChartRow {
  date: string
  ts: number
  expected?: number
  actual?: number
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
    if (current) {
      for (const p of current.projections) {
        const d = p.expected_date ? p.expected_date.slice(0, 10) : ''
        if (!d) continue
        const ts = new Date(d).getTime()
        rows.set(d, { ...(rows.get(d) ?? { date: d, ts }), date: d, ts, expected: lbsToDisplay(p.expected_weight, settings.weight_unit) })
      }
    }
    for (const l of actualLogs) {
      const d = l.logged_at.slice(0, 10)
      const ts = new Date(d).getTime()
      rows.set(d, { ...(rows.get(d) ?? { date: d, ts }), date: d, ts, actual: lbsToDisplay(l.weight, settings.weight_unit) })
    }
    return Array.from(rows.values()).sort((a, b) => a.ts - b.ts)
  }, [current, actualLogs, settings.weight_unit])

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
          <p className="text-xs text-tx-muted mt-2">
            Healthy weight range for your height: {Math.round(bmi.healthy_range_low)}–{Math.round(bmi.healthy_range_high)} lbs
          </p>
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
      <div className="card p-5">
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

      {/* Actual vs expected chart */}
      {current && (
        <div className="card p-5">
          <SectionHeader icon={TrendingDown} title="Actual vs. Expected" />
          {chartData.length < 2 ? (
            <div className="flex items-center justify-center h-40 text-tx-muted text-sm">Not enough data yet</div>
          ) : (
            <div className="h-56 mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="4 4" stroke="var(--color-surface-border)" opacity={0.3} />
                  <XAxis dataKey="date" tickFormatter={d => format(new Date(d), 'MMM d')} fontSize={11} stroke="var(--color-tx-muted)" />
                  <YAxis fontSize={11} stroke="var(--color-tx-muted)" domain={['auto', 'auto']} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={d => format(new Date(d as string), 'MMM d, yyyy')} />
                  <ReferenceLine y={lbsToDisplay(current.goal.target_weight, settings.weight_unit)} stroke={EXPECTED_COLOR} strokeDasharray="3 3" opacity={0.5} />
                  <Line type="monotone" dataKey="expected" name={`Expected (${wUnit})`} stroke={EXPECTED_COLOR} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="actual" name={`Actual (${wUnit})`} stroke={ACTUAL_COLOR} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Adherence / motivation */}
      {current && adherence && (
        <div className="card p-5">
          <SectionHeader
            icon={Flame}
            title="Adherence"
            right={
              <span className={`badge ${adherence.behind_plan ? 'bg-error-500/10 border border-error-500/20 text-error-400' : 'bg-success-500/10 border border-success-500/20 text-success-400'}`}>
                {adherence.behind_plan ? 'Behind plan' : 'On track'}
              </span>
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
