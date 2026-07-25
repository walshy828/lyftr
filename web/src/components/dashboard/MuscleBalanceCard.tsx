import { Dumbbell } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { SectionHeader, Sparkline } from '../ui'
import * as types from '../../types'
import { muscleHex, TOOLTIP_STYLE } from '../../utils/chartTheme'

// "Am I training in balance, or over-indexing one area?" Set-share donut plus a
// per-muscle sparkline of sets/workout over the last 10 sessions.
export default function MuscleBalanceCard({ workouts }: { workouts: types.Workout[] }) {
  const muscleMap = new Map<string, number>()
  workouts.forEach(w => {
    (w.exercises ?? []).forEach(ex => {
      const mg = ex.exercise?.muscle_group || 'other'
      muscleMap.set(mg, (muscleMap.get(mg) || 0) + (ex.sets ?? []).length)
    })
  })
  const muscleData = Array.from(muscleMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }))
  const totalSets = muscleData.reduce((s, d) => s + d.value, 0)
  const topMuscle = muscleData[0]?.name ?? null

  const sparkWorkouts = workouts.slice(0, 10).reverse()
  const sparklines = new Map<string, number[]>()
  muscleData.forEach(({ name }) => {
    sparklines.set(name, sparkWorkouts.map(w =>
      (w.exercises ?? []).filter(ex => ex.exercise?.muscle_group === name).reduce((s, ex) => s + (ex.sets ?? []).length, 0),
    ))
  })

  return (
    <div className="card p-4 min-w-0">
      <SectionHeader
        icon={Dumbbell}
        title="Muscle Balance"
        right={<span className="text-xs text-tx-muted">{workouts.length} workouts</span>}
        className="mb-3"
      />
      {muscleData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <Dumbbell className="w-6 h-6 text-tx-muted opacity-30" />
          <p className="text-xs text-tx-muted">Log workouts to see your training split</p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-shrink-0 flex items-center justify-center">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={muscleData} cx="50%" cy="50%" innerRadius={44} outerRadius={68} dataKey="value" strokeWidth={0} paddingAngle={2}>
                  {muscleData.map((entry, i) => (
                    <Cell key={i} fill={muscleHex(entry.name)} fillOpacity={0.85} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, _: string, props: { payload?: { name: string } }) => [
                    `${v} sets (${Math.round((v / totalSets) * 100)}%)`, props.payload?.name ?? '',
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 w-full min-w-0 space-y-2">
            {muscleData.map(d => {
              const pct = Math.round((d.value / totalSets) * 100)
              const isTop = d.name === topMuscle
              const color = muscleHex(d.name)
              return (
                <div key={d.name}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                    <span className={`text-xs capitalize flex-1 min-w-0 truncate ${isTop ? 'font-semibold text-tx-primary' : 'text-tx-secondary'}`}>
                      {d.name}
                      {isTop && <span className="ml-1 text-[9px] font-normal text-tx-muted uppercase tracking-wide">most</span>}
                    </span>
                    <Sparkline values={sparklines.get(d.name) ?? []} color={color} filled={isTop} emphasis={isTop} />
                    <span className="text-xs text-tx-muted tabular-nums w-16 text-right flex-shrink-0">{d.value} · {pct}%</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-bar transition-all" style={{ width: `${pct}%`, background: color, opacity: isTop ? 1 : 0.6 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
