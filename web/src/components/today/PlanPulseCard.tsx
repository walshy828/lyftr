import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, Target, TrendingDown, AlertTriangle, Hourglass } from 'lucide-react'
import { format } from 'date-fns'
import type { PlanPulse } from '../../utils/planPulse'
import { displayWeight, weightShort } from '../../stores/settings'
import * as types from '../../types'

const TONE = {
  good:    { chip: 'bg-move/15 text-move border-move/30', box: 'bg-move/10 border-move/25', Icon: CheckCircle2 },
  neutral: { chip: 'bg-surface-overlay text-tx-secondary border-surface-border', box: 'bg-surface-overlay/70 border-surface-border', Icon: Hourglass },
  focus:   { chip: 'bg-fuel/15 text-fuel border-fuel/30', box: 'bg-fuel/10 border-fuel/25', Icon: AlertTriangle },
  act:     { chip: 'bg-heart/15 text-heart border-heart/30', box: 'bg-heart/10 border-heart/25', Icon: Target },
} as const

interface Props {
  pulse: PlanPulse
  plan: types.CurrentNutritionGoal
  weightLogs: types.WeightLog[]
  settings: types.UserSettings
}

/**
 * The weight plan, answered in one card: where the trend is vs where the plan
 * says it should be, the pace and finish date that implies, and — the part
 * that matters — whether to change the plan or keep following it.
 */
export default function PlanPulseCard({ pulse: p, plan, weightLogs, settings }: Props) {
  const unit = weightShort(settings.weight_unit)
  const w = (lbs: number) => displayWeight(lbs, settings.weight_unit)
  const tone = TONE[p.tone]

  const finishDelta = p.projectedGoalDate && p.plannedGoalDate
    ? Math.round((p.projectedGoalDate.getTime() - p.plannedGoalDate.getTime()) / (7 * 86_400_000))
    : null

  return (
    <div className="card p-4 space-y-4">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Weight plan</p>
          {p.totalWeeks > 0 && <p className="text-[11px] text-tx-muted tabular-nums">Week {p.weekOfPlan} of {p.totalWeeks}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
          <p className="text-sm text-tx-secondary">
            Goal <span className="font-semibold text-tx-primary">{w(p.target)} {unit}</span>
            {p.plannedGoalDate && <> by {format(p.plannedGoalDate, 'MMM d')}</>}
          </p>
          <span className={`badge border ${tone.chip}`}>
            <tone.Icon className="w-3 h-3" /> {p.headline}
          </span>
        </div>
      </div>

      <PlanChart plan={plan} weightLogs={weightLogs} pulse={p} />

      <div className="grid grid-cols-3 gap-2">
        <Kpi
          label="Trend"
          value={p.trendNow !== null ? `${w(p.trendNow)}` : '—'}
          sub={p.behindBy === null ? `plan ${p.expectedNow !== null ? w(p.expectedNow) : '—'}`
            : Math.abs(p.behindBy) < 0.3 ? 'on plan'
            : `${w(Math.abs(p.behindBy))} ${p.behindBy > 0 ? 'behind' : 'ahead'}`}
          good={p.behindBy !== null && p.behindBy <= 0.3}
        />
        <Kpi
          label="Pace / wk"
          value={p.recentRate !== null ? `${p.recentRate >= 0 ? '' : '+'}${w(Math.abs(p.recentRate))}` : '—'}
          sub={p.planRate !== null ? `plan ${w(p.planRate)}` : ''}
          good={p.recentRate !== null && p.planRate !== null && p.recentRate >= p.planRate * 0.8}
        />
        <Kpi
          label="Finish"
          value={p.projectedGoalDate ? format(p.projectedGoalDate, 'MMM d') : '—'}
          sub={finishDelta === null ? (p.projectedGoalDate ? '' : 'not at this pace')
            : finishDelta === 0 ? 'on schedule'
            : `${Math.abs(finishDelta)} wk ${finishDelta > 0 ? 'late' : 'early'}`}
          good={finishDelta !== null && finishDelta <= 0}
        />
      </div>

      <div className={`rounded-xl border p-3.5 ${tone.box}`}>
        <p className="text-sm font-semibold text-tx-primary flex items-center gap-2">
          <TrendingDown className="w-4 h-4" /> {verdictQuestion(p.verdict)}
        </p>
        <p className="text-sm text-tx-secondary mt-1">{p.detail}</p>
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          {p.recheckOn ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-tx-muted">
              <CalendarClock className="w-3.5 h-3.5" /> Re-check {format(p.recheckOn, 'EEE, MMM d')}
            </span>
          ) : <span />}
          <div className="flex items-center gap-3">
            <Link to="/weight/checkin" className="text-xs font-medium text-tx-muted hover:text-tx-primary">Check-in</Link>
            {p.cta && (
              <Link to={p.cta.to} className="btn-sm btn-primary">
                {p.cta.label} <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function verdictQuestion(v: PlanPulse['verdict']): string {
  switch (v) {
    case 'adjust-plan': return 'Change the plan: yes'
    case 'fix-logging':
    case 'fix-calories': return 'Change the plan: not yet'
    case 'on-track': return 'Change the plan: no'
    case 'ahead-too-fast': return 'Change the plan: maybe ease off'
    case 'goal-reached': return 'Next: a new goal'
    default: return 'Change the plan: wait'
  }
}

function Kpi({ label, value, sub, good }: { label: string; value: string; sub: string; good: boolean }) {
  return (
    <div className="rounded-xl bg-surface-overlay/60 px-3 py-2.5 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{label}</p>
      <p className="text-lg font-bold text-tx-primary tabular-nums leading-tight mt-0.5">{value}</p>
      <p className={`text-[11px] tabular-nums truncate ${good ? 'text-move' : 'text-tx-muted'}`}>{sub}</p>
    </div>
  )
}

/**
 * Plan line (dashed), weigh-ins (dots) and the projected path from today's
 * trend to the goal. Hand-rolled SVG: it's small, and it has to read in one
 * glance rather than be explored.
 */
function PlanChart({ plan, weightLogs, pulse: p }: { plan: types.CurrentNutritionGoal; weightLogs: types.WeightLog[]; pulse: PlanPulse }) {
  const start = new Date(plan.goal.effective_at).getTime()
  const planPts = (plan.projections ?? [])
    .map(pt => ({ t: pt.expected_date ? new Date(pt.expected_date).getTime() : start + pt.week * 7 * 86_400_000, w: pt.expected_weight }))
    .sort((a, b) => a.t - b.t)
  const now = Date.now()
  const from = Math.min(start, now - 28 * 86_400_000)
  const logs = weightLogs
    .map(l => ({ t: new Date(l.logged_at).getTime(), w: l.weight }))
    .filter(l => l.t >= from)
  const end = Math.max(planPts[planPts.length - 1]?.t ?? now, p.projectedGoalDate?.getTime() ?? 0, now + 7 * 86_400_000)
  const ws = [...planPts.map(x => x.w), ...logs.map(x => x.w), p.target]
  if (ws.length < 2) return null
  const lo = Math.min(...ws) - 1, hi = Math.max(...ws) + 1

  const W = 320, H = 96, PAD = 4
  const x = (t: number) => PAD + ((t - from) / (end - from || 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD * 2)
  const path = (pts: { t: number; w: number }[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)},${y(q.w).toFixed(1)}`).join(' ')

  const projection = p.trendNow !== null && p.projectedGoalDate
    ? [{ t: now, w: p.trendNow }, { t: p.projectedGoalDate.getTime(), w: p.target }]
    : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" role="img" aria-label="Weight vs plan">
      <line x1={PAD} x2={W - PAD} y1={y(p.target)} y2={y(p.target)} stroke="var(--surface-border)" strokeDasharray="2 4" />
      <path d={path(planPts)} fill="none" stroke="var(--tx-muted)" strokeWidth={1.5} strokeDasharray="4 4" />
      {projection && <path d={path(projection)} fill="none" stroke="rgb(var(--c-body))" strokeWidth={1.5} strokeDasharray="1 3" strokeLinecap="round" />}
      {logs.map((l, i) => <circle key={i} cx={x(l.t)} cy={y(l.w)} r={1.8} fill="rgb(var(--c-body))" opacity={0.85} />)}
      {p.trendNow !== null && <circle cx={x(now)} cy={y(p.trendNow)} r={4} fill="rgb(var(--c-body))" stroke="var(--surface-raised)" strokeWidth={2} />}
      <line x1={x(now)} x2={x(now)} y1={PAD} y2={H - PAD} stroke="var(--tx-faint)" strokeWidth={1} />
    </svg>
  )
}
