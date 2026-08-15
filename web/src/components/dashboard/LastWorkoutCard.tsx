import { useNavigate, Link } from 'react-router-dom'
import { Dumbbell, ArrowRight } from 'lucide-react'
import { format } from 'date-fns'
import * as types from '../../types'
import { displayWeight, displayVolume, weightShort, displayDistance, distanceShort } from '../../stores/settings'
import { muscleColor, formatExerciseName } from '../../utils/exerciseUtils'
import { isCardio, fmtClock } from '../../utils/workoutSets'
import { calcVolume } from '../../utils/dashboardMetrics'
import { FOCUS_HEX, focusOf, type FocusCategory } from '../../utils/chartTheme'

function dominantFocus(w: types.Workout): FocusCategory | null {
  const counts = new Map<FocusCategory, number>()
  for (const ex of w.exercises ?? []) {
    const cat = focusOf(ex.exercise?.muscle_group ?? '')
    if (cat) counts.set(cat, (counts.get(cat) || 0) + (ex.sets ?? []).length)
  }
  let top: FocusCategory | null = null
  let max = 0
  counts.forEach((v, k) => { if (v > max) { max = v; top = k } })
  return top
}

// The most recent session at a glance — a fast way back into workout detail.
export default function LastWorkoutCard({ workouts, settings }: {
  workouts: types.Workout[]
  settings: types.UserSettings
}) {
  const navigate = useNavigate()
  const wUnit = weightShort(settings.weight_unit)
  const lastWorkout = workouts[0] ?? null

  if (!lastWorkout) {
    return (
      <div className="card p-4 flex flex-col items-center justify-center min-h-36 gap-2">
        <Dumbbell className="w-7 h-7 text-tx-muted opacity-40" />
        <p className="text-sm text-tx-muted">No workouts logged yet</p>
        <button onClick={() => navigate('/workout/start')} className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors mt-1">
          Start your first workout →
        </button>
      </div>
    )
  }

  const exs = lastWorkout.exercises ?? []
  const totalSets = exs.reduce((s, ex) => s + (ex.sets ?? []).length, 0)
  const totalVolume = displayVolume(calcVolume(lastWorkout), settings.weight_unit)
  const mins = Math.round(lastWorkout.duration / 60)
  const focus = dominantFocus(lastWorkout)

  return (
    <div
      className="card p-4 overflow-hidden min-w-0 cursor-pointer active:scale-[0.99] transition-transform"
      onClick={() => navigate(`/workouts/${lastWorkout.id}`)}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-tx-primary truncate">{lastWorkout.name}</p>
          <p className="text-xs text-tx-muted mt-0.5">
            {format(new Date(lastWorkout.started_at), 'MMM d')}
            {mins > 0 && ` · ${mins} min`}
            {totalSets > 0 && ` · ${totalSets} sets`}
            {totalVolume > 0 && ` · ${totalVolume.toLocaleString()} ${wUnit}`}
          </p>
          {focus && (
            <span className="inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: `${FOCUS_HEX[focus]}1a`, color: FOCUS_HEX[focus] }}>
              {focus} Focus
            </span>
          )}
        </div>
        <Link to="/workouts" onClick={e => e.stopPropagation()} className="flex items-center gap-0.5 text-xs text-brand-400 hover:text-brand-300 flex-shrink-0 transition-colors">
          All <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="divide-y divide-surface-border/60">
        {exs.slice(0, 4).map(ex => {
          const sets = ex.sets ?? []
          const cardio = isCardio(ex.exercise)
          const best = sets.length > 0 ? sets.reduce((b, s) => (s.weight > b.weight ? s : b), sets[0]) : null
          return (
            <div key={ex.id} className="flex items-center gap-2.5 py-2.5">
              {ex.exercise.image_url ? (
                <img src={ex.exercise.image_url} alt="" loading="lazy"
                  className="w-8 h-8 rounded-lg object-cover flex-shrink-0 bg-surface-muted"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                  <Dumbbell className="w-3.5 h-3.5 text-brand-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-tx-secondary truncate">{formatExerciseName(ex.exercise.name)}</p>
                <span className={`text-[10px] px-1 py-0.5 rounded ${muscleColor(ex.exercise.muscle_group)}`}>{ex.exercise.muscle_group}</span>
              </div>
              {cardio && best ? (
                <span className="text-xs text-tx-muted tabular-nums flex-shrink-0">
                  {best.duration ? fmtClock(best.duration) : ''}
                  {best.distance ? `${best.duration ? ' · ' : ''}${displayDistance(best.distance, settings.weight_unit)} ${distanceShort(settings.weight_unit)}` : ''}
                </span>
              ) : best && (
                <span className="text-xs text-tx-muted tabular-nums flex-shrink-0">
                  {sets.length}×{best.weight > 0 ? ` ${displayWeight(best.weight, settings.weight_unit)}${wUnit}` : ' BW'}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {exs.length > 4 && <p className="text-xs text-tx-muted text-center pt-2">+{exs.length - 4} more exercises</p>}
    </div>
  )
}
