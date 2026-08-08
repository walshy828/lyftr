import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Stethoscope, Sparkles, ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle, TrendingUp,
  TrendingDown, Minus, Users, Lightbulb, BookOpen, Telescope, Utensils, Dumbbell, Flame, AlertCircle,
} from 'lucide-react'
import Loading from '../components/Loading'
import PageHeader from '../components/ui/PageHeader'
import SectionHeader from '../components/ui/SectionHeader'
import EmptyState from '../components/ui/EmptyState'
import { weightPlanAPI, apiErrorMessage } from '../services/api'
import { useSettingsStore, weightShort, displayWeight } from '../stores/settings'
import * as types from '../types'

// The Progress Check-In: the coaching read on a whole weight-loss journey.
//
// The dashboard's adherence hero answers "am I on the line today?" over seven
// days. This page answers the harder question — how is the plan going overall,
// how do the last few weeks compare to that, how do the numbers sit against
// what people in the same situation typically see, and what should change.
//
// It's explicitly user-run. Generating costs a slow AI call, so nothing here
// triggers on mount: loading only reads the last stored report.

// How the deterministic trend verdict is presented. The pattern is computed
// server-side (controllers.classifyPattern), so this mapping is the one place
// the UI decides what each trend *means* — and it works with no AI provider.
const PATTERNS: Record<types.CheckinPattern, { label: string; color: string; icon: typeof TrendingUp; blurb: string }> = {
  ahead: { label: 'Ahead of plan', color: '#10b981', icon: TrendingDown, blurb: "You're losing faster than your plan asks for." },
  steady: { label: 'Steady', color: '#10b981', icon: Minus, blurb: "Your recent pace is holding where it should be." },
  accelerating: { label: 'Picking up', color: '#10b981', icon: TrendingDown, blurb: "The last few weeks are moving faster than your journey average." },
  slowing: { label: 'Slowing down', color: '#f59e0b', icon: TrendingUp, blurb: 'Still moving, but noticeably slower than before.' },
  stalled: { label: 'Stalled', color: '#f59e0b', icon: Minus, blurb: "The scale hasn't moved meaningfully in the last few weeks." },
  regaining: { label: 'Trending back up', color: '#ef4444', icon: TrendingUp, blurb: 'The recent trend has turned upward.' },
}

const VERDICT_STYLE: Record<types.CheckinBenchmark['verdict'], { label: string; color: string }> = {
  ahead: { label: 'Ahead', color: '#10b981' },
  typical: { label: 'Typical', color: '#00b8d9' },
  behind: { label: 'Behind', color: '#f59e0b' },
}

const EFFORT_STYLE: Record<types.CheckinRecommendation['effort'], string> = {
  easy: 'text-success-400 bg-success-500/10 border-success-500/20',
  moderate: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  hard: 'text-error-400 bg-error-500/10 border-error-500/20',
}

// A stored report older than this is probably describing a different month of
// someone's life — worth a nudge, not a warning.
const STALE_AFTER_DAYS = 14

export default function PlanCheckin() {
  const { settings } = useSettingsStore()
  const unit = settings.weight_unit
  const wUnit = weightShort(unit)

  const [checkin, setCheckin] = useState<types.PlanCheckin | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [noPlan, setNoPlan] = useState(false)

  useEffect(() => {
    let cancelled = false
    weightPlanAPI.checkin()
      .then(c => { if (!cancelled) setCheckin(c) })
      .catch(err => { if (!cancelled) setError(apiErrorMessage(err, 'Could not load your last check-in')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      setCheckin(await weightPlanAPI.runCheckin())
    } catch (err: any) {
      if (err?.response?.status === 404) setNoPlan(true)
      else setError(apiErrorMessage(err, 'Could not run your check-in — try again'))
    } finally {
      setRunning(false)
    }
  }

  const facts = checkin?.facts ?? null
  const report = checkin?.report ?? null
  const pattern = facts ? (PATTERNS[facts.pattern] ?? PATTERNS.steady) : null

  const staleDays = useMemo(() => {
    if (!checkin) return 0
    return Math.floor((Date.now() - new Date(checkin.created_at).getTime()) / 86400000)
  }, [checkin])

  if (loading) return <Loading />

  return (
    <div className="space-y-4 animate-slide-up">
      <PageHeader
        title="Progress Check-In"
        subtitle="How your whole journey is going, and what to do next"
        action={
          <button onClick={run} disabled={running} className="btn-primary btn-sm">
            <Sparkles className={`w-3.5 h-3.5 ${running ? 'animate-pulse' : ''}`} />
            {running ? 'Reviewing…' : checkin ? 'Run again' : 'Run check-in'}
          </button>
        }
      />

      <Link to="/weight/plan" className="inline-flex items-center gap-1 text-xs text-tx-muted hover:text-tx-secondary">
        <ArrowLeft className="w-3 h-3" /> Back to your plan
      </Link>

      {error && (
        <div className="alert-error">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {noPlan && (
        <div className="card p-5">
          <EmptyState
            icon={Stethoscope}
            title="No weight-loss plan yet"
            subtitle="A check-in reviews your progress against a plan — build one first."
            action={<Link to="/weight/plan#generate-plan" className="btn-primary btn-sm">Build a plan <ArrowRight className="w-3.5 h-3.5" /></Link>}
          />
        </div>
      )}

      {running && (
        // The call can run the better part of a minute. Saying what's happening
        // beats a bare spinner that looks indistinguishable from a hang.
        <div className="card p-5 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-brand-400 flex-shrink-0 mt-0.5 animate-pulse" />
          <div>
            <p className="text-sm font-semibold text-tx-primary">Reviewing your journey…</p>
            <p className="text-xs text-tx-muted mt-0.5">
              Comparing your whole plan against the last few weeks, your logging consistency, and typical outcomes. This takes up to a minute.
            </p>
          </div>
        </div>
      )}

      {!checkin && !running && !noPlan && (
        <div className="card p-5">
          <EmptyState
            icon={Stethoscope}
            title="No check-in yet"
            subtitle="Run one to see how you're tracking overall, how the last few weeks compare, and what to change."
            action={<button onClick={run} className="btn-primary btn-sm"><Sparkles className="w-3.5 h-3.5" /> Run check-in</button>}
          />
        </div>
      )}

      {checkin && facts && pattern && (
        <>
          {/* Verdict hero */}
          <div
            className="card p-4 sm:p-5"
            style={{ borderColor: `${pattern.color}55`, background: `linear-gradient(180deg, ${pattern.color}0d, transparent 60%)` }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${pattern.color}1a` }}>
                  <pattern.icon className="w-4 h-4" style={{ color: pattern.color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-tx-primary">{pattern.label}</p>
                  <p className="text-[11px] text-tx-muted">Week {facts.weeks_into_plan} of your current plan</p>
                </div>
              </div>
              <span className="text-[11px] text-tx-muted flex-shrink-0 text-right">
                {formatDistanceToNow(new Date(checkin.created_at), { addSuffix: true })}
              </span>
            </div>

            <p className="text-base sm:text-lg font-semibold text-tx-primary leading-snug">
              {report?.headline || pattern.blurb}
            </p>

            <div className="grid grid-cols-3 gap-2 mt-4">
              <HeroStat label="lost so far" value={displayWeight(facts.lost_lbs, unit)} unit={wUnit} accent={pattern.color} />
              <HeroStat label="of body weight" value={facts.pct_body_weight_lost} unit="%" accent={pattern.color} />
              {/* At zero variance neither "ahead" nor "behind" is true — a
                  freshly accepted plan starts exactly on its own line. */}
              <HeroStat
                label={facts.variance_lbs < 0.1 ? 'on plan' : facts.behind_plan ? 'behind plan' : 'ahead of plan'}
                value={displayWeight(facts.variance_lbs, unit)}
                unit={wUnit}
                accent={facts.behind_plan && facts.variance_lbs >= 0.1 ? '#f59e0b' : '#10b981'}
              />
            </div>

            {staleDays >= STALE_AFTER_DAYS && (
              <p className="text-[11px] text-amber-400 mt-3">
                This check-in is {staleDays} days old — run it again for a current read.
              </p>
            )}
          </div>

          {!report && (
            <div className="alert-info">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>
                Every number below is computed from your own logs. The written coaching review needs an
                AI provider configured on this server — without one, you still get the full readout.
              </span>
            </div>
          )}

          {/* Overall vs recent — the core of the check-in */}
          <div className="card p-5">
            <SectionHeader icon={TrendingDown} title="Overall vs. the last few weeks" />
            <p className="text-xs text-tx-muted mt-1">
              A journey can be on track overall while the last few weeks have stalled. These are judged separately.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <PaceColumn
                title="Whole journey"
                pace={facts.overall_lbs_per_week}
                planPace={facts.plan_lbs_per_week}
                unit={unit}
                wUnit={wUnit}
                text={report?.overall_assessment}
              />
              <PaceColumn
                title={`Last ${facts.recent_window_days} days`}
                pace={facts.recent_lbs_per_week}
                planPace={facts.plan_lbs_per_week}
                unit={unit}
                wUnit={wUnit}
                text={report?.recent_assessment}
                accent={pattern.color}
              />
            </div>

            {facts.projected_goal_date && !facts.projected_goal_date.startsWith('0001') && (
              <p className="text-xs text-tx-secondary mt-4 pt-3 border-t border-surface-border">
                At your current trend you reach {displayWeight(facts.target_weight, unit)} {wUnit} around{' '}
                <span className="font-semibold text-tx-primary">{format(new Date(facts.projected_goal_date), 'MMM d, yyyy')}</span>
                {facts.days_vs_plan_goal_date !== 0 && (
                  <> — {Math.abs(facts.days_vs_plan_goal_date)} days {facts.days_vs_plan_goal_date > 0 ? 'later than' : 'ahead of'} your plan.</>
                )}
              </p>
            )}
          </div>

          {/* Peer benchmarks */}
          {report && report.benchmarks.length > 0 && (
            <div className="card p-5">
              <SectionHeader icon={Users} title="How this compares" />
              <p className="text-xs text-tx-muted mt-1">
                Against what people in a comparable situation typically see. Ranges, not precise figures — individual results vary widely.
              </p>
              <div className="space-y-3 mt-4">
                {report.benchmarks.map((b, i) => {
                  const v = VERDICT_STYLE[b.verdict] ?? VERDICT_STYLE.typical
                  return (
                    <div key={i} className="rounded-lg bg-surface-overlay/60 p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-tx-primary min-w-0">{b.label}</p>
                        <span
                          className="badge flex-shrink-0"
                          style={{ background: `${v.color}1a`, color: v.color, border: `1px solid ${v.color}33` }}
                        >
                          {v.label}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-lg font-bold tabular-nums" style={{ color: v.color }}>{b.user_value}</span>
                        {/* No hardcoded "typically" — the model's range often
                            carries its own hedge, and doubling it up reads as
                            "vs. typically typically 4-8%". */}
                        <span className="text-xs text-tx-muted">vs. {b.typical_range}</span>
                      </div>
                      <p className="text-xs text-tx-secondary mt-1">{b.context}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* What's working / slipping */}
          {report && (report.whats_working.length > 0 || report.whats_slipping.length > 0) && (
            <div className="grid lg:grid-cols-2 gap-4 min-w-0">
              {report.whats_working.length > 0 && (
                <PointsCard title="What's working" icon={CheckCircle2} color="#10b981" points={report.whats_working} />
              )}
              {report.whats_slipping.length > 0 && (
                <PointsCard title="What's slipping" icon={AlertTriangle} color="#f59e0b" points={report.whats_slipping} />
              )}
            </div>
          )}

          {/* Recommendations */}
          {report && report.recommendations.length > 0 && (
            <div className="card p-5">
              <SectionHeader icon={Lightbulb} title="What to change" />
              <p className="text-xs text-tx-muted mt-1">Most impactful first.</p>
              <div className="space-y-3 mt-4">
                {report.recommendations.map((r, i) => (
                  <div key={i} className="rounded-lg border border-surface-border p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold text-tx-primary min-w-0">{r.title}</p>
                      <span className={`badge flex-shrink-0 border capitalize ${EFFORT_STYLE[r.effort] ?? EFFORT_STYLE.moderate}`}>
                        {r.effort}
                      </span>
                    </div>
                    <p className="text-sm text-tx-secondary">{r.detail}</p>
                    {r.why_it_works && (
                      <p className="text-xs text-tx-muted mt-1.5 italic">Why it works: {r.why_it_works}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Adherence across windows */}
          <div className="card p-5">
            <SectionHeader icon={Utensils} title="Consistency over time" />
            <p className="text-xs text-tx-muted mt-1">
              Calorie and protein averages cover the days you actually logged, not the whole window.
            </p>
            <div className="overflow-x-auto no-scrollbar mt-4">
              <table className="w-full text-sm min-w-[26rem]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-tx-muted">
                    <th className="text-left font-medium pb-2">Window</th>
                    <th className="text-right font-medium pb-2"><Utensils className="w-3 h-3 inline" /> Logged</th>
                    <th className="text-right font-medium pb-2"><Dumbbell className="w-3 h-3 inline" /> Workouts</th>
                    <th className="text-right font-medium pb-2"><Flame className="w-3 h-3 inline" /> Avg kcal</th>
                    <th className="text-right font-medium pb-2">Avg protein</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.adherence.map(w => {
                    const over = w.calorie_target > 0 && w.avg_calories > w.calorie_target + 150
                    return (
                      <tr key={w.days} className="border-t border-surface-border">
                        <td className="py-2 text-tx-secondary">Last {w.days} days</td>
                        <td className="py-2 text-right tabular-nums text-tx-primary">{w.food_logged_days}/{w.days}</td>
                        <td className="py-2 text-right tabular-nums text-tx-primary">{w.workout_days}</td>
                        <td className={`py-2 text-right tabular-nums ${over ? 'text-amber-400' : 'text-tx-primary'}`}>
                          {w.avg_calories > 0 ? Math.round(w.avg_calories).toLocaleString() : '—'}
                          {w.calorie_target > 0 && <span className="text-tx-muted"> / {w.calorie_target.toLocaleString()}</span>}
                        </td>
                        <td className="py-2 text-right tabular-nums text-tx-primary">
                          {w.avg_protein > 0 ? `${Math.round(w.avg_protein)} g` : '—'}
                          {w.protein_target > 0 && <span className="text-tx-muted"> / {w.protein_target} g</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* General playbook */}
          {report && report.what_works_generally.length > 0 && (
            <PointsCard
              title="What usually works"
              icon={BookOpen}
              color="#00b8d9"
              points={report.what_works_generally}
              subtitle="The general playbook for this situation, regardless of your own numbers."
            />
          )}

          {report?.outlook && (
            <div className="card p-5">
              <SectionHeader icon={Telescope} title="The outlook" />
              <p className="text-sm text-tx-secondary mt-3">{report.outlook}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function HeroStat({ label, value, unit, accent }: { label: string; value: number; unit: string; accent: string }) {
  return (
    <div className="rounded-lg bg-surface-overlay/60 p-2.5 text-center">
      <p className="text-lg font-bold tabular-nums leading-none" style={{ color: accent }}>
        {value}<span className="text-xs font-medium text-tx-muted ml-0.5">{unit}</span>
      </p>
      <p className="text-[10px] text-tx-muted mt-1">{label}</p>
    </div>
  )
}

// One side of the overall-vs-recent comparison. Pace is in lbs LOST per week,
// so a negative value means the weight went the other way — shown explicitly
// rather than as a bare negative number.
function PaceColumn({
  title, pace, planPace, unit, wUnit, text, accent,
}: {
  title: string
  pace: number
  planPace: number
  unit: string
  wUnit: string
  text?: string
  accent?: string
}) {
  // A pace inside the noise band isn't "0 lb/week lost", it's no movement —
  // say that rather than dressing a stall up as a loss.
  const flat = Math.abs(pace) < 0.05
  const gaining = pace < 0
  const color = accent ?? (gaining ? '#ef4444' : '#10b981')
  const vsPlan = planPace > 0 ? pace - planPace : null
  return (
    <div className="rounded-lg bg-surface-overlay/60 p-3">
      <p className="text-[11px] uppercase tracking-wider text-tx-muted font-medium">{title}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        {flat ? (
          <span className="text-2xl font-bold leading-none" style={{ color }}>No change</span>
        ) : (
          <>
            <span className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>
              {displayWeight(Math.abs(pace), unit)}
            </span>
            <span className="text-xs text-tx-muted">{wUnit}/week {gaining ? 'gained' : 'lost'}</span>
          </>
        )}
      </div>
      {vsPlan !== null && (
        <p className="text-[11px] text-tx-muted mt-1 tabular-nums">
          Plan asks for {displayWeight(planPace, unit)} {wUnit}/week
          {Math.abs(vsPlan) >= 0.05 && (
            <> · {displayWeight(Math.abs(vsPlan), unit)} {vsPlan > 0 ? 'faster' : 'slower'}</>
          )}
        </p>
      )}
      {text && <p className="text-sm text-tx-secondary mt-2">{text}</p>}
    </div>
  )
}

function PointsCard({
  title, icon, color, points, subtitle,
}: {
  title: string
  icon: typeof CheckCircle2
  color: string
  points: types.CheckinPoint[]
  subtitle?: string
}) {
  const Icon = icon
  return (
    <div className="card p-5">
      <SectionHeader icon={icon} title={title} />
      {subtitle && <p className="text-xs text-tx-muted mt-1">{subtitle}</p>}
      <ul className="space-y-3 mt-4">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2">
            <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-tx-primary">{p.title}</p>
              <p className="text-sm text-tx-secondary">{p.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
