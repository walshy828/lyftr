import { useEffect, useMemo, useState } from 'react'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import Loading from '../Loading'
import DrillableTrendChart, { ChartTableToggle } from '../charts/DrillableTrendChart'
import { useStatsControlsContext } from '../../context/StatsControlsContext'
import { aggregateByPeriod } from '../../utils/aggregate'
import { foodAPI } from '../../services/api'
import { TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE, ENERGY_COLORS } from '../../utils/chartTheme'
import * as types from '../../types'

/** Calorie and macro trends over time. Trend-only — per-meal detail already
 *  lives on the Food page.
 *
 *  `foodAPI.history` only takes a day count and always ends "today" (no
 *  from/to params) — a backend limitation left as-is per the client-side-only
 *  aggregation constraint. We derive a day count from the global `from`, then
 *  clip the result to [from, to] client-side so a custom `to` in the past is
 *  still honored even though the fetch itself can't target it directly. */
export default function NutritionPanel() {
  const { from, to, aggregation } = useStatsControlsContext()
  const [history, setHistory] = useState<types.FoodHistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [calView, setCalView] = useState<'chart' | 'table'>('chart')
  const [macroView, setMacroView] = useState<'chart' | 'table'>('chart')

  useEffect(() => {
    setLoading(true)
    const days = from != null ? differenceInCalendarDays(new Date(), parseISO(from)) + 1 : 3650
    foodAPI.history(days)
      .then(d => setHistory((d || []).slice().reverse()))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [from, to])

  const clipped = useMemo(
    () => history.filter(h => (from == null || h.date >= from) && h.date <= to),
    [history, from, to],
  )

  const calorieData = useMemo(() => {
    const points = clipped.map(h => ({ date: h.date, calories: h.calories }))
    return aggregateByPeriod(points, 'date', aggregation, [{ key: 'calories', agg: 'avg' }])
      .map(p => ({ date: p.date, calories: Math.round(p.calories ?? 0) }))
  }, [clipped, aggregation])
  const macroData = useMemo(() => {
    const points = clipped.map(h => ({ date: h.date, protein: h.protein, carbs: h.carbs, fat: h.fat }))
    return aggregateByPeriod(points, 'date', aggregation, [
      { key: 'protein', agg: 'avg' },
      { key: 'carbs', agg: 'avg' },
      { key: 'fat', agg: 'avg' },
    ]).map(p => ({
      date: p.date,
      protein: Math.round(p.protein ?? 0),
      carbs: Math.round(p.carbs ?? 0),
      fat: Math.round(p.fat ?? 0),
    }))
  }, [clipped, aggregation])

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
          <ChartTableToggle view={calView} onChange={setCalView} />
        </div>
        <DrillableTrendChart
          data={calorieData}
          xKey="date"
          view={calView}
          onViewChange={setCalView}
          hideToggle
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
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="section-title">Macros</h2>
          <ChartTableToggle view={macroView} onChange={setMacroView} />
        </div>
        <DrillableTrendChart
          data={macroData}
          xKey="date"
          view={macroView}
          onViewChange={setMacroView}
          hideToggle
          emptyMessage="Log a few more days to see a trend."
          columns={[
            { key: 'date', label: 'Date', format: r => fmtDate(r.date) },
            { key: 'protein', label: 'Protein (g)' },
            { key: 'carbs', label: 'Carbs (g)' },
            { key: 'fat', label: 'Fat (g)' },
          ]}
          renderChart={data => (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
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
        />
      </div>
    </div>
  )
}
