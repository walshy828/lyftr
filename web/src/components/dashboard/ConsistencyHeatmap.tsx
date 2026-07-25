import { Activity } from 'lucide-react'
import { format, startOfWeek, endOfWeek, subWeeks, eachDayOfInterval } from 'date-fns'
import { SectionHeader } from '../ui'
import * as types from '../../types'

const NOW = new Date()

// GitHub-style 12-week contribution grid — "am I showing up consistently?"
export default function ConsistencyHeatmap({ workouts }: { workouts: types.Workout[] }) {
  const heatmapStart = startOfWeek(subWeeks(NOW, 11), { weekStartsOn: 1 })
  const heatmapEnd = endOfWeek(NOW, { weekStartsOn: 1 })
  const heatmapDays = eachDayOfInterval({ start: heatmapStart, end: heatmapEnd })

  const workoutDayMap = new Map<string, number>()
  workouts.forEach(w => {
    const k = format(new Date(w.started_at), 'yyyy-MM-dd')
    workoutDayMap.set(k, (workoutDayMap.get(k) || 0) + 1)
  })

  const weeks: Date[][] = []
  for (let i = 0; i < heatmapDays.length; i += 7) weeks.push(heatmapDays.slice(i, i + 7))
  const monthLabels: (string | null)[] = weeks.map((week, i) => {
    const m = format(week[0], 'MMM')
    if (i === 0) return m
    return m !== format(weeks[i - 1][0], 'MMM') ? m : null
  })

  return (
    <div className="card p-4">
      <SectionHeader
        icon={Activity}
        title="Consistency"
        right={<span className="text-xs text-tx-muted">12 weeks</span>}
        className="mb-3"
      />
      {workouts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <p className="text-xs text-tx-muted">Start working out to build your streak</p>
        </div>
      ) : (
        <>
          <div className="w-full" style={{ display: 'grid', gridTemplateColumns: `1.25rem repeat(${weeks.length}, 1fr)`, gap: '2px' }}>
            <div />
            {weeks.map((_, i) => (
              <div key={i} className="text-[9px] text-tx-muted font-medium overflow-visible whitespace-nowrap leading-none pb-0.5">
                {monthLabels[i] ?? ''}
              </div>
            ))}
            {(['M', '', 'W', '', 'F', '', 'S'] as const).map((lbl, dayIdx) => [
              <div key={`lbl-${dayIdx}`} className="text-[9px] text-tx-muted/60 font-medium flex items-center leading-none">{lbl}</div>,
              ...weeks.map((week, wi) => {
                const day = week[dayIdx]
                const count = workoutDayMap.get(format(day, 'yyyy-MM-dd')) || 0
                const future = day > NOW
                return (
                  <div
                    key={`${wi}-${dayIdx}`}
                    title={`${format(day, 'MMM d')}${count > 0 ? ` · ${count} workout${count > 1 ? 's' : ''}` : ''}`}
                    className={`h-3 rounded-[2px] transition-colors ${
                      future ? 'bg-surface-muted/20' : count === 0 ? 'bg-surface-muted/50' : count === 1 ? 'bg-brand-500/50' : 'bg-brand-500'
                    }`}
                  />
                )
              }),
            ])}
          </div>
          <div className="flex items-center gap-1.5 mt-2 justify-end">
            <span className="text-[9px] text-tx-muted">Less</span>
            {['bg-surface-muted/50', 'bg-brand-500/30', 'bg-brand-500/60', 'bg-brand-500'].map((cls, i) => (
              <div key={i} className={`w-3 h-3 rounded-[3px] ${cls}`} />
            ))}
            <span className="text-[9px] text-tx-muted">More</span>
          </div>
        </>
      )}
    </div>
  )
}
