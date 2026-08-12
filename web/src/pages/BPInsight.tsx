import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Sparkles, AlertTriangle, Stethoscope, TrendingDown, TrendingUp,
  Minus, HelpCircle, CalendarClock, Info,
} from 'lucide-react'
import { format, parseISO, differenceInDays } from 'date-fns'
import { bloodPressureAPI, apiErrorMessage } from '../services/api'
import { BP_CATEGORIES, formatBP } from '../utils/bloodPressure'
import PageHeader from '../components/ui/PageHeader'
import SectionHeader from '../components/ui/SectionHeader'
import * as types from '../types'

/** Past this, the report is describing a version of you that has moved on. */
const STALE_AFTER_DAYS = 21

const DIRECTION = {
  helping: { label: 'Helping', Icon: TrendingDown, cls: 'text-success-400' },
  hurting: { label: 'Working against you', Icon: TrendingUp, cls: 'text-error-400' },
  unclear: { label: 'Unclear', Icon: HelpCircle, cls: 'text-tx-muted' },
} as const

const TREND = {
  improving: { label: 'Improving', Icon: TrendingDown, cls: 'text-success-400' },
  worsening: { label: 'Rising', Icon: TrendingUp, cls: 'text-error-400' },
  stable: { label: 'Steady', Icon: Minus, cls: 'text-tx-secondary' },
} as const

export default function BPInsight() {
  const [insight, setInsight] = useState<types.BPInsight | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  // Read only. Generating on mount would spend an AI call every time someone
  // opens the page.
  useEffect(() => {
    bloodPressureAPI.insight()
      .then(setInsight)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      setInsight(await bloodPressureAPI.runInsight())
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not build your insight.'))
    } finally {
      setRunning(false)
    }
  }

  const facts = insight?.facts ?? null
  const report = insight?.report ?? null
  const w30 = facts?.windows.find(w => w.days === 30)
  const staleDays = insight ? differenceInDays(new Date(), parseISO(insight.created_at)) : 0

  return (
    <div className="space-y-5 animate-slide-up">
      <Link to="/health?tab=bp" className="inline-flex items-center gap-1.5 text-sm text-tx-muted hover:text-tx-primary transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Blood Pressure
      </Link>

      <PageHeader
        title="Blood Pressure Insight"
        subtitle="Your readings read against your training, weight and nutrition"
        action={
          <button type="button" onClick={run} disabled={running} className="btn-primary btn-sm">
            <Sparkles className="w-3.5 h-3.5" />
            {running ? 'Reviewing…' : insight ? 'Run again' : 'Run insight'}
          </button>
        }
      />

      {error && (
        <div className="alert-error" role="alert" aria-live="polite">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {running && (
        // An explanatory wait, not a spinner — this call takes up to a minute
        // and an unexplained spinner that long reads as a hang.
        <div className="card p-5 text-center">
          <Sparkles className="w-6 h-6 text-brand-500 mx-auto mb-2 animate-pulse" />
          <p className="text-sm font-medium text-tx-primary">Reviewing your readings…</p>
          <p className="text-xs text-tx-muted mt-1">
            Weighing your averages against your training, weight and sodium data.
            This takes up to a minute.
          </p>
        </div>
      )}

      {loading ? (
        <div className="h-40 rounded-2xl bg-surface-overlay animate-pulse" />
      ) : !insight ? (
        <div className="card p-6 text-center">
          <Sparkles className="w-8 h-8 text-tx-muted mx-auto mb-3" />
          <p className="text-sm text-tx-secondary">
            Run an insight to see what your readings mean, which of your habits
            line up with them, and what to do about anything out of range.
          </p>
          <p className="text-xs text-tx-muted mt-2">
            Needs at least 3 readings across 2 days.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-tx-muted">
            Generated {format(parseISO(insight.created_at), 'MMM d, yyyy')}
            {staleDays >= STALE_AFTER_DAYS && ' — your readings have likely moved on since. Worth running again.'}
          </p>

          {/* Escalation gets a fixed, prominent slot rather than a sentence
              buried in prose. */}
          {report?.see_a_doctor && (
            <div
              className="flex items-start gap-3 rounded-xl border border-red-600/40 bg-red-600/15 px-4 py-3 text-sm text-red-300"
              role="alert"
              data-testid="bp-see-a-doctor"
            >
              <Stethoscope className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>{report.see_a_doctor}</p>
            </div>
          )}

          {/* Facts render with or without a provider. */}
          {facts && w30 && (
            <div className="card p-5">
              <SectionHeader icon={CalendarClock} title="The numbers" className="mb-3" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="stat-label">30-day average</p>
                  <p className="stat-value tabular-nums">
                    {w30.days_with_data ? formatBP(w30.avg_systolic, w30.avg_diastolic) : '—'}
                  </p>
                  {facts.category && (
                    <span className={`badge border mt-1 ${BP_CATEGORIES[facts.category].chip}`}>
                      {BP_CATEGORIES[facts.category].label}
                    </span>
                  )}
                </div>
                <div>
                  <p className="stat-label">Trend</p>
                  {facts.trend_label && TREND[facts.trend_label as keyof typeof TREND] ? (
                    <p className={`stat-value flex items-center gap-1.5 ${TREND[facts.trend_label as keyof typeof TREND].cls}`}>
                      {TREND[facts.trend_label as keyof typeof TREND].label}
                    </p>
                  ) : (
                    <p className="stat-value">—</p>
                  )}
                  <p className="text-xs text-tx-muted mt-1 tabular-nums">
                    {facts.sys_per_30d >= 0 ? '+' : ''}{facts.sys_per_30d.toFixed(1)} mmHg / 30 days
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-surface-border text-center">
                <div>
                  <p className="text-xs text-tx-muted">Measured</p>
                  <p className="text-sm font-semibold text-tx-primary tabular-nums">
                    {w30.days_with_data}/30 days
                  </p>
                </div>
                <div>
                  <p className="text-xs text-tx-muted">Trained</p>
                  <p className="text-sm font-semibold text-tx-primary tabular-nums">
                    {facts.training.workout_days_30} days
                  </p>
                </div>
                <div>
                  <p className="text-xs text-tx-muted">Avg sodium</p>
                  <p className="text-sm font-semibold text-tx-primary tabular-nums">
                    {/* 0 means sodium wasn't recorded, not that they ate none. */}
                    {facts.nutrition.avg_sodium_mg > 0
                      ? `${Math.round(facts.nutrition.avg_sodium_mg)} mg`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {!report && (
            <div className="alert-info" role="status">
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>
                Every number above is computed from your own logs. The written
                review needs an AI provider configured on this server.
              </span>
            </div>
          )}

          {report && (
            <>
              <div className="card p-5">
                <h2 className="font-display font-bold text-lg text-tx-primary">{report.headline}</h2>
                <p className="text-sm text-tx-secondary mt-2 leading-relaxed">{report.where_you_stand}</p>
                <p className="text-sm text-tx-secondary mt-3 leading-relaxed">{report.trend_reading}</p>
              </div>

              {report.contributors.length > 0 && (
                <div className="card p-5">
                  <SectionHeader icon={Sparkles} title="What's moving the needle" className="mb-3" />
                  <div className="space-y-3">
                    {report.contributors.map((c, i) => {
                      const d = DIRECTION[c.direction] ?? DIRECTION.unclear
                      return (
                        <div key={i} className="flex items-start gap-3">
                          <d.Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${d.cls}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-tx-primary">
                              {c.factor}
                              <span className={`ml-2 text-xs font-normal ${d.cls}`}>{d.label}</span>
                              <span className="ml-1.5 text-xs text-tx-muted">({c.strength})</span>
                            </p>
                            <p className="text-xs text-tx-secondary mt-0.5 leading-relaxed">{c.evidence}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-tx-muted mt-3">
                    These are associations in your own log, not proven causes.
                  </p>
                </div>
              )}

              {report.action_plan.length > 0 && (
                <div className="card p-5">
                  <SectionHeader icon={Sparkles} title="Your plan" className="mb-3" />
                  <ol className="space-y-4">
                    {report.action_plan.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-6 h-6 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-brand-500">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-tx-primary">
                            {s.title}
                            <span className="ml-2 badge">{s.effort}</span>
                            <span className="ml-1 text-xs text-tx-muted">{s.horizon}</span>
                          </p>
                          <p className="text-xs text-tx-secondary mt-1 leading-relaxed">{s.detail}</p>
                          <p className="text-xs text-tx-muted mt-1 leading-relaxed">{s.why_it_works}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {report.measurement_tips.length > 0 && (
                <div className="card p-5">
                  <SectionHeader icon={CalendarClock} title="Measuring better" className="mb-3" />
                  <div className="space-y-3">
                    {report.measurement_tips.map((t, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium text-tx-primary">{t.title}</p>
                        <p className="text-xs text-tx-secondary mt-0.5 leading-relaxed">{t.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.outlook && (
                <div className="card p-5">
                  <SectionHeader icon={Sparkles} title="Outlook" className="mb-2" />
                  <p className="text-sm text-tx-secondary leading-relaxed">{report.outlook}</p>
                </div>
              )}
            </>
          )}

          <p className="text-[11px] text-tx-muted leading-relaxed px-1">
            This is not medical advice and does not diagnose anything. Home
            readings inform a conversation with your doctor — they don't replace
            one. Categories follow the ACC/AHA 2017 guideline and are based on
            your average, not any single reading.
          </p>
        </>
      )}
    </div>
  )
}
