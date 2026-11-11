import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Timer, Zap, Search, ChevronRight, ChevronLeft, Footprints, ClipboardList, Trash2, CalendarCheck } from 'lucide-react'
import Sheet from '../ui/Sheet'
import { programAPI } from '../../services/api'
import { useWorkoutSession } from '../../stores/workoutSession'
import { useStartRoutine } from '../../hooks/useStartRoutine'
import { KIND_META, KINDS } from '../../utils/trainingKinds'
import * as types from '../../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Today's scheduled routines that aren't done yet. */
  today: types.ScheduledProgram[]
  onLogCardio: () => void
}

/**
 * The one way into training, from the Train button.
 *
 * Two questions, in the order people ask them: am I starting something now
 * (what's scheduled, any other routine, or a blank session), or logging
 * something I already did (cardio, or a lift/stretch session after the fact)?
 */
export default function TrainSheet({ isOpen, onClose, today, onLogCardio }: Props) {
  const navigate = useNavigate()
  const { session, cancelSession } = useWorkoutSession()
  const { startRoutine, startEmpty } = useStartRoutine()
  const [picking, setPicking] = useState(false)
  const [routines, setRoutines] = useState<types.Program[] | null>(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<types.TrainingKind | 'all'>('all')

  useEffect(() => {
    if (!isOpen) { setPicking(false); setQ(''); setKind('all'); return }
    programAPI.list({ sort: 'smart', limit: 100 }).then(r => setRoutines(r ?? [])).catch(() => setRoutines([]))
  }, [isOpen])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (routines ?? []).filter(r =>
      (kind === 'all' || (r.kind ?? 'strength') === kind) &&
      (!needle || r.name.toLowerCase().includes(needle)))
  }, [routines, q, kind])

  const startScheduled = (id: number) => {
    const full = routines?.find(r => r.id === id)
    if (full) startRoutine(full)
    else navigate(`/workout/start?program=${id}`)
  }

  if (picking) {
    return (
      <Sheet isOpen={isOpen} onClose={onClose} title="Choose a routine">
        <div className="px-5 pb-5 space-y-3">
          <button onClick={() => setPicking(false)} className="inline-flex items-center gap-1 text-xs text-tx-muted hover:text-tx-primary">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tx-muted pointer-events-none" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} className="input pl-8 py-1.5 text-sm" placeholder="Search routines…" />
          </div>
          <KindChips value={kind} onChange={setKind} />
          {routines === null ? (
            <p className="text-sm text-tx-muted py-4 text-center">Loading routines…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-tx-muted py-4 text-center">{routines.length ? 'No routines match.' : 'No routines yet.'}</p>
          ) : (
            <ul className="divide-y divide-surface-border -mx-1">
              {filtered.map(r => {
                const m = KIND_META[r.kind ?? 'strength']
                return (
                  <li key={r.id}>
                    <button onClick={() => startRoutine(r)} className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-surface-muted/40 rounded-lg">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.tint}`}><m.icon className="w-4 h-4" /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-tx-primary truncate">{r.name}</span>
                        <span className="block text-[11px] text-tx-muted">{r.exercises?.length ?? 0} exercises · {m.label}</span>
                      </span>
                      <Play className="w-4 h-4 text-brand-400 flex-shrink-0" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Train">
      <div className="px-5 pb-5 space-y-5">
        {session && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 flex items-center gap-3">
            <Timer className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-tx-primary truncate">{session.name}</span>
              <span className="block text-[11px] text-amber-400/80">In progress</span>
            </span>
            <button onClick={() => navigate('/workout/active')} className="btn-primary btn-sm"><Play className="w-3.5 h-3.5" /> Resume</button>
            <button onClick={() => cancelSession()} aria-label="Discard workout" className="btn-ghost btn-sm"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        )}

        <section>
          <p className="eyebrow mb-2">Start now</p>
          <div className="space-y-2">
            {!session && today.map(p => {
              const m = KIND_META[p.kind ?? 'strength']
              return (
                <SheetRow key={p.program_id} onClick={() => startScheduled(p.program_id)}
                  icon={<span className={`w-9 h-9 rounded-lg flex items-center justify-center ${m.tint}`}><CalendarCheck className="w-4 h-4" /></span>}
                  title={p.name} sub={`Scheduled today · ${p.exercise_count} exercises`} primary />
              )
            })}
            <SheetRow disabled={!!session} onClick={() => setPicking(true)}
              icon={<span className="w-9 h-9 rounded-lg flex items-center justify-center bg-train/15 text-train"><ClipboardList className="w-4 h-4" /></span>}
              title="Choose a routine" sub="Anything, scheduled or not" />
            <SheetRow disabled={!!session} onClick={startEmpty}
              icon={<span className="w-9 h-9 rounded-lg flex items-center justify-center bg-surface-overlay text-tx-secondary"><Zap className="w-4 h-4" /></span>}
              title="Empty workout" sub="Add exercises as you go" />
          </div>
        </section>

        <section>
          <p className="eyebrow mb-2">Log something you already did</p>
          <div className="space-y-2">
            <SheetRow onClick={onLogCardio}
              icon={<span className={`w-9 h-9 rounded-lg flex items-center justify-center ${KIND_META.cardio.tint}`}><Footprints className="w-4 h-4" /></span>}
              title="Cardio" sub="Walk, run, bike, swim — time, distance, steps" />
            <SheetRow onClick={() => navigate('/workouts/new')}
              icon={<span className={`w-9 h-9 rounded-lg flex items-center justify-center ${KIND_META.strength.tint}`}><ClipboardList className="w-4 h-4" /></span>}
              title="Strength or mobility" sub="From a routine or from scratch, any date" />
          </div>
          <p className="text-[11px] text-tx-muted mt-2">Watch sessions synced from Google Health count automatically.</p>
        </section>
      </div>
    </Sheet>
  )
}

export function KindChips({ value, onChange }: { value: types.TrainingKind | 'all'; onChange: (k: types.TrainingKind | 'all') => void }) {
  const opts: (types.TrainingKind | 'all')[] = ['all', ...KINDS]
  return (
    <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 no-scrollbar" role="group" aria-label="Filter by type">
      {opts.map(k => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={value === k}
          className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            value === k ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-surface-muted/40 text-tx-muted border-transparent hover:border-surface-border'
          }`}>
          {k === 'all' ? 'All' : KIND_META[k].label}
        </button>
      ))}
    </div>
  )
}

function SheetRow({ icon, title, sub, onClick, primary, disabled }: {
  icon: React.ReactNode; title: string; sub: string; onClick: () => void; primary?: boolean; disabled?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors disabled:opacity-40 ${
        primary ? 'border-brand-500/40 bg-brand-500/10 hover:bg-brand-500/15' : 'border-surface-border bg-surface-muted/30 hover:border-brand-500/30'
      }`}>
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-tx-primary truncate">{title}</span>
        <span className="block text-[11px] text-tx-muted truncate">{sub}</span>
      </span>
      {primary ? <Play className="w-4 h-4 text-brand-400" /> : <ChevronRight className="w-4 h-4 text-tx-muted" />}
    </button>
  )
}
