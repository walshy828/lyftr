import { useEffect, useMemo, useState } from 'react'
import { format, startOfWeek, subWeeks, addDays } from 'date-fns'
import { Scale } from 'lucide-react'
import { trainingAPI } from '../../services/api'
import { buildTrainWeek, goalProgress, type GoalProgress } from '../../utils/trainWeek'
import { KIND_META, MODALITIES } from '../../utils/trainingKinds'
import { SectionHeader } from '../ui'
import type { Modality, TrainingGoal, TrainingTypeDay } from '../../types'

const WEEKS = 8
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export interface BalanceRow {
  kind: Modality
  weeks: GoalProgress[]
  met: number
  minutes: number
  sessions: number
}

/** Per type, how each of the last N weeks (oldest first) tracked its goal. Pure, for tests. */
export function buildBalance(now: Date, typeDays: TrainingTypeDay[], goals: TrainingGoal[], weeks = WEEKS): BalanceRow[] {
  const thisWeek = startOfWeek(now, { weekStartsOn: 1 })
  const perWeek = Array.from({ length: weeks }, (_, i) => {
    const anchor = subWeeks(thisWeek, weeks - 1 - i)
    return goalProgress(buildTrainWeek(anchor, [], [], [], typeDays).byKind, goals)
  })
  return MODALITIES.map(kind => {
    const rows = perWeek.map(w => w.find(p => p.kind === kind)!).filter(Boolean)
    return {
      kind,
      weeks: rows,
      met: rows.filter(r => r.met).length,
      minutes: rows.reduce((s, r) => s + r.done.minutes, 0),
      sessions: rows.reduce((s, r) => s + r.done.sessions, 0),
    }
  })
}

/** One sentence on where the balance is off. The current week is excluded: it isn't over. */
export function balanceInsight(rows: BalanceRow[]): string | null {
  const scored = rows
    .filter(r => r.weeks[0] && (r.weeks[0].goal.days_per_week > 0 || r.weeks[0].goal.minutes_per_week > 0))
    .map(r => ({ r, rate: r.weeks.slice(0, -1).filter(w => w.met).length / Math.max(1, r.weeks.length - 1) }))
  if (scored.length === 0) return null
  // Ties resolve in strength → cardio → mobility order, so the sentence is stable.
  const low = scored.reduce((a, b) => (b.rate < a.rate ? b : a))
  const high = scored.reduce((a, b) => (b.rate > a.rate ? b : a))
  const done = (x: typeof low) => x.r.weeks.slice(0, -1).filter(w => w.met).length
  const of = rows[0].weeks.length - 1
  if (low.rate === high.rate) {
    return low.rate === 1 ? `Every goal met for ${of} straight weeks.` : `All three types are tracking about evenly (${done(low)} of ${of} weeks met).`
  }
  return `${KIND_META[high.r.kind].label} is your strongest (${done(high)} of ${of} weeks met); ${KIND_META[low.r.kind].label.toLowerCase()} is the one slipping (${done(low)} of ${of}).`
}

/**
 * The last eight weeks, one row per training type, one cell per week: how
 * full the cell is = progress toward that week's goal; a solid cell = met.
 * The point is the comparison across rows — lifting vs cardio vs stretching.
 */
export default function TrainingBalanceCard() {
  const [now] = useState(() => new Date())
  const [typeDays, setTypeDays] = useState<TrainingTypeDay[]>([])
  const [goals, setGoals] = useState<TrainingGoal[]>([])

  useEffect(() => {
    const from = subWeeks(startOfWeek(now, { weekStartsOn: 1 }), WEEKS - 1)
    Promise.all([
      trainingAPI.days(iso(from), iso(addDays(startOfWeek(now, { weekStartsOn: 1 }), 6))).catch(() => []),
      trainingAPI.goals().catch(() => []),
    ]).then(([d, g]) => { setTypeDays(d); setGoals(g) })
  }, [now])

  const rows = useMemo(() => buildBalance(now, typeDays, goals), [now, typeDays, goals])
  const insight = useMemo(() => (goals.length ? balanceInsight(rows) : null), [rows, goals])

  if (!goals.length) return null

  return (
    <div className="card p-4">
      <SectionHeader icon={Scale} title="Training balance" right={<span className="text-xs text-tx-muted">last {WEEKS} weeks vs goal</span>} className="mb-3" />
      <div className="space-y-2.5">
        {rows.map(r => {
          const m = KIND_META[r.kind]
          return (
            <div key={r.kind} className="flex items-center gap-2.5">
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${m.tint}`}><m.icon className="w-3.5 h-3.5" /></span>
              <span className="w-16 text-sm font-semibold text-tx-primary flex-shrink-0">{m.label}</span>
              <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${r.weeks.length}, minmax(0, 1fr))` }}>
                {r.weeks.map((w, i) => (
                  <span
                    key={i}
                    title={`${w.label}${w.met ? ' — met' : ''}`}
                    className="h-5 rounded bg-surface-overlay relative overflow-hidden"
                  >
                    <span
                      className={`absolute inset-x-0 bottom-0 ${m.bg} ${w.met ? '' : 'opacity-50'}`}
                      style={{ height: `${Math.max(w.ratio, w.done.sessions ? 0.08 : 0) * 100}%` }}
                    />
                    {i === r.weeks.length - 1 && <span className="absolute inset-0 rounded ring-1 ring-inset ring-tx-faint" />}
                  </span>
                ))}
              </div>
              <span className="w-12 text-right text-xs text-tx-muted tabular-nums flex-shrink-0">{r.met}/{r.weeks.length}</span>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-surface-border text-center">
        {rows.map(r => (
          <div key={r.kind}>
            <p className="text-base font-bold tabular-nums text-tx-primary leading-tight">{Math.round(r.minutes / WEEKS)}<span className="text-xs font-normal text-tx-muted"> min/wk</span></p>
            <p className="text-[10px] text-tx-muted">{KIND_META[r.kind].label.toLowerCase()} · {r.sessions} sessions</p>
          </div>
        ))}
      </div>
      {insight && <p className="text-xs text-tx-secondary mt-3">{insight}</p>}
    </div>
  )
}
