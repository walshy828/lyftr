import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { SectionHeader } from '../ui'
import * as types from '../../types'

const NOW = new Date()

interface Chip {
  label: string
  count: number
  color: string
}

/**
 * How strength and cardio overlap over a trailing window — days that were
 * strength-only, cardio-only, both, or rest. Reuses the same server-computed
 * daily arrays already fetched for ConsistencyHeatmap, so this adds zero new
 * requests. Distinct from the heatmap's 'both' mode: that blends a day's
 * VALUE into one shade; this counts how many days fell into each CATEGORY.
 */
export default function ActivityOverlapCard({
  workoutDaily, cardioDaily, days = 30,
}: {
  workoutDaily: types.TrainingDay[]
  cardioDaily: types.CardioDay[]
  days?: number
}) {
  const chips = useMemo<Chip[]>(() => {
    const workoutDates = new Set(workoutDaily.map(d => d.date))
    const cardioDates = new Set(cardioDaily.map(d => d.date))

    let strengthOnly = 0
    let cardioOnly = 0
    let both = 0
    let rest = 0
    for (let i = 0; i < days; i++) {
      const key = format(subDays(NOW, i), 'yyyy-MM-dd')
      const hadWorkout = workoutDates.has(key)
      const hadCardio = cardioDates.has(key)
      if (hadWorkout && hadCardio) both++
      else if (hadWorkout) strengthOnly++
      else if (hadCardio) cardioOnly++
      else rest++
    }

    return [
      { label: 'Strength', count: strengthOnly, color: '#2563eb' },
      { label: 'Cardio', count: cardioOnly, color: '#ef4444' },
      { label: 'Both', count: both, color: '#a78bfa' },
      { label: 'Rest', count: rest, color: 'var(--tx-muted)' },
    ]
  }, [workoutDaily, cardioDaily, days])

  return (
    <div className="card p-4">
      <SectionHeader icon={Layers} title="Activity Mix" className="mb-1" />
      <p className="text-[11px] text-tx-muted mb-3">
        Last {days} days · cardio synced from Health Connect
      </p>
      <div className="grid grid-cols-4 gap-2">
        {chips.map(chip => (
          <div key={chip.label} className="flex flex-col items-center gap-0.5 py-2 rounded-lg bg-surface-overlay">
            <span className="font-display font-bold text-xl tabular-nums" style={{ color: chip.color }}>
              {chip.count}
            </span>
            <span className="text-[10px] text-tx-muted">{chip.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
