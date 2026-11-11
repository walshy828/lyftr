import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Play, Plus, Sparkles, ChevronRight } from 'lucide-react'
import { KIND_META } from '../../utils/trainingKinds'
import { useStartRoutine } from '../../hooks/useStartRoutine'
import { useWorkoutSession } from '../../stores/workoutSession'
import { KindChips } from './TrainSheet'
import * as types from '../../types'

// Monday-first, matching the week strip; the API speaks Go's time.Weekday.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAY_SHORT: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }

/**
 * Every routine, searchable and filterable by type, with the weekdays each one
 * sits on — so "which routines do I have and when do I do them" is one list
 * instead of three screens.
 */
export default function RoutineList({ routines, recurring }: {
  routines: types.Program[]
  recurring: types.RecurringSchedule
}) {
  const { startRoutine } = useStartRoutine()
  const { session } = useWorkoutSession()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<types.TrainingKind | 'all'>('all')

  const daysByRoutine = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const wd of WEEKDAY_ORDER) {
      for (const slot of recurring[String(wd)] ?? []) {
        m.set(slot.program_id, [...(m.get(slot.program_id) ?? []), wd])
      }
    }
    return m
  }, [recurring])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return routines.filter(r =>
      (kind === 'all' || (r.kind ?? 'strength') === kind) &&
      (!needle || r.name.toLowerCase().includes(needle)))
  }, [routines, q, kind])

  return (
    <section id="routines" className="card p-4 scroll-mt-20 lg:scroll-mt-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="eyebrow">Routines</h2>
        <div className="flex gap-1.5">
          <Link to="/routines/ai-new" className="btn-ghost btn-sm"><Sparkles className="w-3.5 h-3.5" /> With AI</Link>
          <Link to="/routines/new" className="btn-secondary btn-sm"><Plus className="w-3.5 h-3.5" /> New</Link>
        </div>
      </div>

      {routines.length === 0 ? (
        <p className="text-sm text-tx-muted py-2">No routines yet — build one yourself or let AI draft it from your goals.</p>
      ) : (
        <>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tx-muted pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} className="input pl-8 py-1.5 text-sm" placeholder="Search routines…" />
          </div>
          <KindChips value={kind} onChange={setKind} />
          {visible.length === 0 ? (
            <p className="text-sm text-tx-muted py-3">No routines match.</p>
          ) : (
            <ul className="divide-y divide-surface-border mt-2">
              {visible.map(r => {
                const m = KIND_META[r.kind ?? 'strength']
                const days = daysByRoutine.get(r.id)
                return (
                  <li key={r.id} className="flex items-center gap-2 py-2">
                    <Link to={`/routines/${r.id}`} className="flex-1 min-w-0 flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.tint}`}><m.icon className="w-4 h-4" /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-tx-primary truncate">{r.name}</span>
                        <span className="block text-[11px] text-tx-muted truncate">
                          {r.exercises?.length ?? 0} exercises · {days ? days.map(d => WEEKDAY_SHORT[d]).join(', ') : 'Not scheduled'}
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-tx-faint flex-shrink-0 ml-auto" />
                    </Link>
                    <button onClick={() => startRoutine(r)} aria-label={`Start ${r.name}`} disabled={!!session} title={session ? 'Finish the workout in progress first' : undefined} className="btn-secondary btn-sm flex-shrink-0">
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
