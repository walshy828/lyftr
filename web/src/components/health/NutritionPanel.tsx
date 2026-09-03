import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import Loading from '../Loading'
import PeriodSelector from '../PeriodSelector'
import DrillableTrendChart from '../charts/DrillableTrendChart'
import { foodAPI } from '../../services/api'
import { TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE, ENERGY_COLORS } from '../../utils/chartTheme'
import * as types from '../../types'

const PERIODS = ['7d', '30d', '90d'] as const
type Period = typeof PERIODS[number]
const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 }

/** Calorie and macro trends over time. Trend-only — per-meal detail already
 *  lives on the Food page. */
export default function NutritionPanel() {
  const [period, setPeriod] = useState<Period>('30d')
  const [history, setHistory] = useState<types.FoodHistoryPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    foodAPI.history(PERIOD_DAYS[period]).then(d => setHistory((d || []).slice().reverse())).catch(() => setHistory([])).finally(() => setLoading(false))
  }, [period])

  const calorieData = useMemo(
    () => history.map(h => ({ date: h.date, calories: Math.round(h.calories) })),
    [history],
  )
  const macroData = useMemo(
    () => history.map(h => ({
      date: h.date,
      protein: Math.round(h.protein),
      carbs: Math.round(h.carbs),
      fat: Math.round(h.fat),
    })),
    [history],
  )

  const avgCalories = useMemo(() => {
    if (calorieData.length === 0) return null
    return Math.round(calorieData.reduce((a, b) => a + b.calories, 0) / calorieData.length)
  }, [calorieData])

  const fmtDate = (d: string) => { try { return format(parseISO(d.slice(0, 10)), 'MMM d') } catch { return d } }

  if (loading) return <Loading />

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div>
            <h2 className="section-title">Calories</h2>
            {avgCalories != null && <p className="text-xs text-tx-muted mt-0.5">{avgCalories.toLocaleString()} avg/day</p>}
          </div>
          <PeriodSelector options={PERIODS} value={period} onChange={setPeriod} />
        </div>
        <DrillableTrendChart
          data={calorieData}
          xKey="date"
          emptyMessage="Log a few more days to see a trend."
          columns={[
            { key: 'date', label: 'Date', format: r => fmtDate(r.date) },
            { key: 'calories', label: 'Calories', format: r => r.calories.toLocaleString() },
          ]}
          renderChart={data => (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtDate} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={fmtDate}
                  formatter={(v: number) => [`${v.toLocaleString()} kcal`, 'Calories']}
                />
                <Line dataKey="calories" stroke={ENERGY_COLORS.calories} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        />
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-3">Macros</h2>
        {macroData.length < 2 ? (
          <p className="text-sm text-tx-muted py-6 text-center">Log a few more days to see a trend.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={macroData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtDate} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} unit="g" />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={fmtDate}
                  formatter={(v: number, name: string) => [`${v} g`, name]}
                />
                <Bar dataKey="protein" name="Protein" stackId="m" fill={ENERGY_COLORS.protein} isAnimationActive={false} />
                <Bar dataKey="carbs" name="Carbs" stackId="m" fill={ENERGY_COLORS.carbs} isAnimationActive={false} />
                <Bar dataKey="fat" name="Fat" stackId="m" fill={ENERGY_COLORS.fat} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-4 mt-2">
              {(['protein', 'carbs', 'fat'] as const).map(k => (
                <span key={k} className="flex items-center gap-1.5 text-[11px] text-tx-muted capitalize">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: ENERGY_COLORS[k] }} />
                  {k}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
