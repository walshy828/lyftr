import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, Play, Check, ArrowRight } from 'lucide-react'
import * as types from '../../types'

/**
 * What today's plan says, when there is one.
 *
 * Renders nothing at all when the user has no schedule — an empty "Rest day"
 * card on an account that never opted into scheduling is noise, not
 * information. `hasSchedule` distinguishes "planned rest" from "no plan".
 */
export default function TodaysWorkoutCard({
  today,
  hasSchedule,
}: {
  today: types.ScheduledDay | null
  hasSchedule: boolean
}) {
  const navigate = useNavigate()
  if (!today || !hasSchedule) return null

  const programs = today.programs
  const allDone = programs.length > 0 && programs.every(p => p.completed_workout_id)

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-brand-400" />
          <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider">Today's plan</p>
        </div>
        <Link to="/plan" className="inline-flex items-center gap-1 text-xs text-tx-muted hover:text-tx-secondary transition-colors">
          Plan <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {programs.length === 0 ? (
        <p className="text-sm text-tx-secondary">
          Rest day. <span className="text-tx-muted">Nothing scheduled — train anyway if you feel good.</span>
        </p>
      ) : (
        <div className="space-y-2">
          {programs.map(p => (
            <div key={p.program_id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-tx-primary truncate">{p.name}</p>
                <p className="text-xs text-tx-muted">{p.exercise_count} exercises</p>
              </div>
              {p.completed_workout_id ? (
                <button
                  onClick={() => navigate(`/workouts/${p.completed_workout_id}`)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-brand-500/15 text-brand-300 border border-brand-500/25 flex-shrink-0"
                >
                  <Check className="w-3.5 h-3.5" /> Done
                </button>
              ) : (
                <button
                  onClick={() => navigate(`/workout/start?program=${p.program_id}`)}
                  className="btn-primary btn-sm flex-shrink-0"
                >
                  <Play className="w-3.5 h-3.5" /> Start
                </button>
              )}
            </div>
          ))}
          {allDone && (
            <p className="text-xs text-brand-400 pt-1">Everything on today's plan is done.</p>
          )}
        </div>
      )}
    </div>
  )
}
