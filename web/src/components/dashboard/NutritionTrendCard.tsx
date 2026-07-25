import { useState } from 'react'
import { Apple } from 'lucide-react'
import { format, subDays, eachDayOfInterval } from 'date-fns'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { SectionHeader } from '../ui'
import PeriodSelector from '../PeriodSelector'
import * as types from '../../types'
import { ENERGY_COLORS, TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE } from '../../utils/chartTheme'

const NOW = new Date()

// "Am I eating consistently against my targets over time?" Toggles between
// %-of-target lines and the macro-mix composition.
export default function NutritionTrendCard({ foodHistory, settings }: {
  foodHistory: types.FoodHistoryPoint[]
  settings: types.UserSettings
}) {
  const [period, setPeriod] = useState<'7' | '14' | '30' | '90'>('7')
  const [view, setView] = useState<'% of Target' | 'Macro Mix'>('% of Target')

  // Zero-fill so gaps read as "didn't log" rather than a broken line.
  const trendStart = subDays(NOW, 89)
  const byDate = new Map(foodHistory.map(p => [p.date, p]))
  const filled = eachDayOfInterval({ start: trendStart, end: NOW }).map(d => {
    const k = format(d, 'yyyy-MM-dd')
    const p = byDate.get(k)
    return { date: k, calories: p?.calories ?? 0, protein: p?.protein ?? 0, carbs: p?.carbs ?? 0, fat: p?.fat ?? 0 }
  })
  const days = Number(period)
  const slice = filled.slice(-days)
  const prevSlice = filled.slice(-days * 2, -days)
  const hasHistory = filled.some(p => p.calories > 0)

  const pctData = slice.map(p => ({
    date: format(new Date(p.date), 'M/d'),
    calPct: Math.round((p.calories / settings.calorie_target) * 100),
    protPct: Math.round((p.protein / settings.protein_target) * 100),
    carbPct: Math.round((p.carbs / settings.carb_target) * 100),
  }))
  const mixData = slice.map(p => {
    const protCal = p.protein * 4, carbCal = p.carbs * 4, fatCal = p.fat * 9
    const total = protCal + carbCal + fatCal
    return {
      date: format(new Date(p.date), 'M/d'),
      protPct: total > 0 ? Math.round((protCal / total) * 100) : 0,
      carbPct: total > 0 ? Math.round((carbCal / total) * 100) : 0,
      fatPct: total > 0 ? Math.round((fatCal / total) * 100) : 0,
    }
  })

  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0)
  const loggedSlice = slice.filter(p => p.calories > 0)
  const avgCal = avg(loggedSlice.map(p => p.calories))
  const avgProt = avg(loggedSlice.map(p => p.protein))
  const avgCarb = avg(loggedSlice.map(p => p.carbs))
  const avgFat = avg(loggedSlice.map(p => p.fat))
  const avgMacroCal = avgProt * 4 + avgCarb * 4 + avgFat * 9
  const shareP = avgMacroCal > 0 ? Math.round((avgProt * 4 / avgMacroCal) * 100) : 0
  const shareC = avgMacroCal > 0 ? Math.round((avgCarb * 4 / avgMacroCal) * 100) : 0
  const shareF = avgMacroCal > 0 ? Math.round((avgFat * 9 / avgMacroCal) * 100) : 0
  const prevLogged = prevSlice.filter(p => p.calories > 0)
  const prevAvgCal = avg(prevLogged.map(p => p.calories))
  const calChangePct = prevAvgCal > 0 ? Math.round(((avgCal - prevAvgCal) / prevAvgCal) * 100) : null

  const legend = view === '% of Target'
    ? [['Calories', ENERGY_COLORS.calories], ['Protein', ENERGY_COLORS.protein], ['Carbs', ENERGY_COLORS.carbs]] as const
    : [['Protein', ENERGY_COLORS.protein], ['Carbs', ENERGY_COLORS.carbs], ['Fat', ENERGY_COLORS.fat]] as const

  return (
    <div className="card p-4 min-w-0">
      <SectionHeader
        icon={Apple}
        title="Nutrition Trend"
        right={<PeriodSelector options={['7', '14', '30', '90'] as const} value={period} onChange={setPeriod} />}
        className="mb-2"
      />
      {!hasHistory ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <Apple className="w-6 h-6 text-tx-muted opacity-40" />
          <p className="text-xs text-tx-muted">Log food to see trends</p>
        </div>
      ) : (
        <>
          <div className="mb-2">
            <PeriodSelector options={['% of Target', 'Macro Mix'] as const} value={view} onChange={setView} />
          </div>
          <div className="w-full min-w-0">
            <ResponsiveContainer width="100%" height={130}>
              {view === '% of Target' ? (
                <LineChart data={pctData}>
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis hide domain={[0, 'dataMax']} />
                  <ReferenceLine y={100} stroke={GRID_STROKE} strokeDasharray="3 3" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v}%`, name]} />
                  <Line dataKey="calPct" name="Calories" dot={false} stroke={ENERGY_COLORS.calories} strokeWidth={2} type="monotone" isAnimationActive={false} />
                  <Line dataKey="protPct" name="Protein" dot={false} stroke={ENERGY_COLORS.protein} strokeWidth={2} type="monotone" isAnimationActive={false} />
                  <Line dataKey="carbPct" name="Carbs" dot={false} stroke={ENERGY_COLORS.carbs} strokeWidth={2} type="monotone" isAnimationActive={false} />
                </LineChart>
              ) : (
                <AreaChart data={mixData} stackOffset="expand">
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis hide />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v}%`, name]} />
                  <Area dataKey="protPct" name="Protein" stackId="mix" stroke={ENERGY_COLORS.protein} fill={ENERGY_COLORS.protein} fillOpacity={0.7} isAnimationActive={false} />
                  <Area dataKey="carbPct" name="Carbs" stackId="mix" stroke={ENERGY_COLORS.carbs} fill={ENERGY_COLORS.carbs} fillOpacity={0.7} isAnimationActive={false} />
                  <Area dataKey="fatPct" name="Fat" stackId="mix" stroke={ENERGY_COLORS.fat} fill={ENERGY_COLORS.fat} fillOpacity={0.7} isAnimationActive={false} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
            {legend.map(([label, color]) => (
              <div key={label} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-[10px] text-tx-muted">{label}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-tx-muted mt-2">
            Avg {Math.round(avgCal).toLocaleString()} kcal/day · P {shareP}% · C {shareC}% · F {shareF}%
            {calChangePct !== null && (
              <span className={calChangePct >= 0 ? 'text-success-400' : 'text-error-400'}>
                {' · '}{calChangePct >= 0 ? '▲' : '▼'} {Math.abs(calChangePct)}% kcal vs prior {days}d
              </span>
            )}
          </p>
        </>
      )}
    </div>
  )
}
