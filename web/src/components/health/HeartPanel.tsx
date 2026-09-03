import { useEffect, useMemo, useState } from 'react'
import { HeartPulse, Activity } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Bar, ComposedChart } from 'recharts'
import Loading from '../Loading'
import PeriodSelector from '../PeriodSelector'
import { usePeriodFilter } from '../../hooks/usePeriodFilter'
import { healthMetricsAPI, sleepAPI } from '../../services/api'
import { TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE, SLEEP_STAGE_COLORS } from '../../utils/chartTheme'
import * as types from '../../types'

const HRV_COLOR = '#8b5cf6'
const RESTING_HR_COLOR = '#ef4444'

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** A day-bucketed metric trend, sized for a small dashboard card. */
function MetricLineChart({ data, dataKey, color, unit, label }: {
  data: { day: string; value: number }[]
  dataKey: string
  color: string
  unit: string
  label: string
}) {
  if (data.length < 2) {
    return <p className="text-sm text-tx-muted py-6 text-center">Not enough {label.toLowerCase()} data synced yet.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false}
          tickFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d } }}
          formatter={(v: number) => [`${v} ${unit}`, label]}
        />
        <Line dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** HRV, resting heart rate, and how deep sleep tracks alongside them — all
 *  synced read-only from a companion device via Health Connect. */
export default function HeartPanel() {
  const { period, setPeriod, from, to, PERIODS } = usePeriodFilter('30d')
  const [hrv, setHrv] = useState<types.HealthMetricDailyStat[]>([])
  const [restingHr, setRestingHr] = useState<types.HealthMetricDailyStat[]>([])
  const [sleepTrend, setSleepTrend] = useState<types.SleepTrendPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      healthMetricsAPI.daily('hrv_rmssd', from, to, 'avg').catch(() => []),
      healthMetricsAPI.daily('resting_heart_rate', from, to, 'avg').catch(() => []),
      sleepAPI.trend(from, to, 'week').catch(() => []),
    ]).then(([h, r, s]) => {
      setHrv(h || [])
      setRestingHr(r || [])
      setSleepTrend(s || [])
    }).finally(() => setLoading(false))
  }, [from, to])

  const hrvData = useMemo(() => hrv.map(d => ({ day: d.day, value: Math.round(d.value) })), [hrv])
  const restingHrData = useMemo(() => restingHr.map(d => ({ day: d.day, value: Math.round(d.value) })), [restingHr])

  const avgHrv = useMemo(() => average(hrv.map(d => d.value)), [hrv])
  const avgRestingHr = useMemo(() => average(restingHr.map(d => d.value)), [restingHr])

  const contextData = useMemo(
    () => sleepTrend.map(t => ({
      bucket: t.bucket,
      deepMinutes: Math.round(t.avg_deep_minutes),
      restingHR: t.avg_resting_hr != null ? Math.round(t.avg_resting_hr) : null,
    })),
    [sleepTrend],
  )

  if (loading) return <Loading />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <PeriodSelector options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Activity className="w-3.5 h-3.5" style={{ color: HRV_COLOR }} />
            <span className="stat-label">Avg HRV</span>
          </div>
          <p className="stat-value text-2xl">{avgHrv != null ? Math.round(avgHrv) : '—'}<span className="text-xs text-tx-muted font-normal ml-1">ms</span></p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <HeartPulse className="w-3.5 h-3.5" style={{ color: RESTING_HR_COLOR }} />
            <span className="stat-label">Avg Resting HR</span>
          </div>
          <p className="stat-value text-2xl">{avgRestingHr != null ? Math.round(avgRestingHr) : '—'}<span className="text-xs text-tx-muted font-normal ml-1">bpm</span></p>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-3">HRV trend</h2>
        <MetricLineChart data={hrvData} dataKey="value" color={HRV_COLOR} unit="ms" label="HRV" />
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-3">Resting heart rate trend</h2>
        <MetricLineChart data={restingHrData} dataKey="value" color={RESTING_HR_COLOR} unit="bpm" label="Resting HR" />
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-1">Recovery context</h2>
        <p className="text-xs text-tx-muted mb-3">Deep sleep and resting heart rate, week over week.</p>
        {contextData.length < 2 ? (
          <p className="text-sm text-tx-muted py-6 text-center">Not enough nights synced yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={contextData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false}
                tickFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }} />
              <YAxis yAxisId="mins" tick={AXIS_TICK} axisLine={false} tickLine={false} width={36}
                tickFormatter={(v: number) => `${Math.round(v)}m`} />
              <YAxis yAxisId="hr" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }} />
              <Bar yAxisId="mins" dataKey="deepMinutes" name="Deep sleep" fill={SLEEP_STAGE_COLORS.deep} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="hr" dataKey="restingHR" name="Resting HR" stroke={RESTING_HR_COLOR} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
