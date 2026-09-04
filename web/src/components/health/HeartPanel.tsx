import { useEffect, useMemo, useState } from 'react'
import { HeartPulse, Activity } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Bar, BarChart, ComposedChart, Brush, Legend } from 'recharts'
import Loading from '../Loading'
import DrillableTrendChart, { RawSeriesChart, ChartTableToggle } from '../charts/DrillableTrendChart'
import { useStatsControlsContext } from '../../context/StatsControlsContext'
import { aggregateByPeriod, type Granularity } from '../../utils/aggregate'
import { healthMetricsAPI, heartRateAPI, sleepAPI } from '../../services/api'
import { TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE, SLEEP_STAGE_COLORS, HR_ZONE_COLORS } from '../../utils/chartTheme'
import * as types from '../../types'

const HRV_COLOR = '#8b5cf6'
const RESTING_HR_COLOR = '#ef4444'
const HR_MIN_COLOR = HR_ZONE_COLORS.zone1
const HR_AVG_COLOR = HR_ZONE_COLORS.zone3
const HR_MAX_COLOR = HR_ZONE_COLORS.zone5

const ZONE_FIELDS: { key: keyof types.HeartRateZoneMinutes; label: string; color: string }[] = [
  { key: 'below_zone_1_minutes', label: 'Below zone 1', color: HR_ZONE_COLORS.belowZone1 },
  { key: 'zone_1_minutes', label: 'Zone 1', color: HR_ZONE_COLORS.zone1 },
  { key: 'zone_2_minutes', label: 'Zone 2', color: HR_ZONE_COLORS.zone2 },
  { key: 'zone_3_minutes', label: 'Zone 3', color: HR_ZONE_COLORS.zone3 },
  { key: 'zone_4_minutes', label: 'Zone 4', color: HR_ZONE_COLORS.zone4 },
  { key: 'zone_5_minutes', label: 'Zone 5', color: HR_ZONE_COLORS.zone5 },
]

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

const fmtDay = (d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }

/** A day-bucketed metric trend + chart/table toggle + highlight-to-drill-down
 *  into the raw samples behind any selected stretch. */
function MetricTrendCard({ data, color, unit, label, metricType, view, onViewChange }: {
  data: { day: string; value: number }[]
  color: string
  unit: string
  label: string
  metricType: types.MetricType
  view: 'chart' | 'table'
  onViewChange: (v: 'chart' | 'table') => void
}) {
  return (
    <DrillableTrendChart
      data={data}
      xKey="day"
      view={view}
      onViewChange={onViewChange}
      hideToggle
      emptyMessage={`Not enough ${label.toLowerCase()} data synced yet.`}
      columns={[
        { key: 'day', label: 'Date', format: r => fmtDay(r.day) },
        { key: 'value', label: `${label} (${unit})` },
      ]}
      granularFetcher={(from, to) => healthMetricsAPI.list(metricType, from, to)}
      renderGranular={(rows: types.HealthMetric[]) => (
        <RawSeriesChart rows={rows} xKey="recorded_at" yKey="value" color={color} unit={unit} chartType="line" />
      )}
      renderChart={(chartData, onBrushChange) => (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtDay} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d } }}
              formatter={(v: number) => [`${v} ${unit}`, label]}
            />
            <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Brush dataKey="day" height={18} stroke={color} travellerWidth={8} tickFormatter={fmtDay} onChange={onBrushChange} />
          </LineChart>
        </ResponsiveContainer>
      )}
    />
  )
}

/** Daily min/avg/max BPM trend, for the daily/weekly/monthly granularities. */
function HeartRateTrendCard({ data, view, onViewChange }: {
  data: (types.HeartRateDailyStat & { day: string })[]
  view: 'chart' | 'table'
  onViewChange: (v: 'chart' | 'table') => void
}) {
  return (
    <DrillableTrendChart
      data={data}
      xKey="day"
      view={view}
      onViewChange={onViewChange}
      hideToggle
      emptyMessage="Not enough heart rate data synced yet."
      columns={[
        { key: 'day', label: 'Date', format: r => fmtDay(r.day) },
        { key: 'min', label: 'Min (bpm)' },
        { key: 'avg', label: 'Avg (bpm)' },
        { key: 'max', label: 'Max (bpm)' },
      ]}
      granularFetcher={(from, to) => heartRateAPI.list(from, to)}
      renderGranular={(rows: types.HeartRateSample[]) => (
        <RawSeriesChart rows={rows} xKey="recorded_at" yKey="bpm" color={HR_AVG_COLOR} unit="bpm" chartType="line" />
      )}
      renderChart={(chartData, onBrushChange) => (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtDay} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d } }}
              formatter={(v: number, name: string) => [`${v} bpm`, name]}
            />
            <Line dataKey="min" name="Min" stroke={HR_MIN_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="avg" name="Avg" stroke={HR_AVG_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="max" name="Max" stroke={HR_MAX_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
            <Brush dataKey="day" height={18} stroke={HR_AVG_COLOR} travellerWidth={8} tickFormatter={fmtDay} onChange={onBrushChange} />
          </LineChart>
        </ResponsiveContainer>
      )}
    />
  )
}

/** Individual heart-rate samples, for the 'transactional' granularity —
 *  plots every reading rather than a daily rollup. */
function HeartRateRawTrendCard({ data, view, onViewChange }: {
  data: types.HeartRateSample[]
  view: 'chart' | 'table'
  onViewChange: (v: 'chart' | 'table') => void
}) {
  return (
    <DrillableTrendChart
      data={data}
      xKey="recorded_at"
      view={view}
      onViewChange={onViewChange}
      hideToggle
      emptyMessage="Not enough heart rate data synced yet."
      columns={[
        { key: 'recorded_at', label: 'Time', format: r => { try { return format(parseISO(r.recorded_at), 'MMM d, h:mm a') } catch { return r.recorded_at } } },
        { key: 'bpm', label: 'BPM' },
      ]}
      renderChart={() => (
        <RawSeriesChart rows={data} xKey="recorded_at" yKey="bpm" color={HR_AVG_COLOR} unit="bpm" chartType="line" />
      )}
    />
  )
}

/** HRV, resting heart rate, and how deep sleep tracks alongside them — all
 *  synced read-only from a companion device via Health Connect. */
export default function HeartPanel() {
  const { from, to, aggregation } = useStatsControlsContext()
  const [hrv, setHrv] = useState<types.HealthMetricDailyStat[]>([])
  const [restingHr, setRestingHr] = useState<types.HealthMetricDailyStat[]>([])
  const [sleepTrend, setSleepTrend] = useState<types.SleepTrendPoint[]>([])
  const [hrDaily, setHrDaily] = useState<types.HeartRateDailyStat[]>([])
  const [hrRaw, setHrRaw] = useState<types.HeartRateSample[]>([])
  const [hrZones, setHrZones] = useState<types.HeartRateZoneMinutes[]>([])
  const [loading, setLoading] = useState(true)
  const [hrvView, setHrvView] = useState<'chart' | 'table'>('chart')
  const [restingView, setRestingView] = useState<'chart' | 'table'>('chart')
  const [hrView, setHrView] = useState<'chart' | 'table'>('chart')

  const isTransactional = aggregation === 'transactional'

  useEffect(() => {
    setLoading(true)
    Promise.all([
      healthMetricsAPI.daily('hrv_rmssd', from, to, 'avg').catch(() => []),
      healthMetricsAPI.daily('resting_heart_rate', from, to, 'avg').catch(() => []),
      sleepAPI.trend(from, to, 'day').catch(() => []),
      isTransactional ? Promise.resolve([]) : heartRateAPI.daily(from, to).catch(() => []),
      heartRateAPI.zones(from, to).catch(() => []),
      isTransactional ? heartRateAPI.list(from, to).catch(() => []) : Promise.resolve([]),
    ]).then(([h, r, s, hr, z, raw]) => {
      setHrv(h || [])
      setRestingHr(r || [])
      setSleepTrend(s || [])
      setHrDaily(hr || [])
      setHrZones(z || [])
      setHrRaw(raw || [])
    }).finally(() => setLoading(false))
  }, [from, to, isTransactional])

  const bucketAvg = (points: { day: string; value: number }[], granularity: Granularity) =>
    aggregateByPeriod(points, 'day', granularity, [{ key: 'value', agg: 'avg' }])
      .map(p => ({ day: p.day, value: Math.round(p.value ?? 0) }))

  const hrvData = useMemo(
    () => bucketAvg(hrv.map(d => ({ day: d.day, value: d.value })), aggregation),
    [hrv, aggregation],
  )
  const restingHrData = useMemo(
    () => bucketAvg(restingHr.map(d => ({ day: d.day, value: d.value })), aggregation),
    [restingHr, aggregation],
  )

  const avgHrv = useMemo(() => average(hrv.map(d => d.value)), [hrv])
  const avgRestingHr = useMemo(() => average(restingHr.map(d => d.value)), [restingHr])

  const hrTrendData = useMemo(() => (
    aggregateByPeriod(hrDaily, 'day', aggregation, [
      { key: 'min', agg: 'min' },
      { key: 'avg', agg: 'avg' },
      { key: 'max', agg: 'max' },
    ]).map(d => ({ ...d, min: Math.round(d.min), avg: Math.round(d.avg), max: Math.round(d.max) }))
  ), [hrDaily, aggregation])

  const hrZonesData = useMemo(() => (
    aggregateByPeriod(hrZones, 'day', aggregation, ZONE_FIELDS.map(f => ({ key: f.key, agg: 'sum' as const })))
      .map(d => ({ ...d, ...Object.fromEntries(ZONE_FIELDS.map(f => [f.key, Math.round((d[f.key] as number) ?? 0)])) }))
  ), [hrZones, aggregation])

  const contextData = useMemo(() => {
    const points = sleepTrend.map(t => ({ bucket: t.bucket, deepMinutes: t.avg_deep_minutes, restingHR: t.avg_resting_hr }))
    return aggregateByPeriod(points, 'bucket', aggregation, [
      { key: 'deepMinutes', agg: 'avg' },
      { key: 'restingHR', agg: 'avg' },
    ]).map(p => ({
      bucket: p.bucket,
      deepMinutes: Math.round(p.deepMinutes ?? 0),
      restingHR: p.restingHR != null ? Math.round(p.restingHR) : null,
    }))
  }, [sleepTrend, aggregation])

  if (loading) return <Loading />

  return (
    <div className="space-y-5">
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
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="section-title">HRV trend</h2>
          <ChartTableToggle view={hrvView} onChange={setHrvView} />
        </div>
        <MetricTrendCard data={hrvData} color={HRV_COLOR} unit="ms" label="HRV" metricType="hrv_rmssd" view={hrvView} onViewChange={setHrvView} />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="section-title">Resting heart rate trend</h2>
          <ChartTableToggle view={restingView} onChange={setRestingView} />
        </div>
        <MetricTrendCard data={restingHrData} color={RESTING_HR_COLOR} unit="bpm" label="Resting HR" metricType="resting_heart_rate" view={restingView} onViewChange={setRestingView} />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="section-title">Heart rate trend</h2>
          <ChartTableToggle view={hrView} onChange={setHrView} />
        </div>
        {isTransactional ? (
          <HeartRateRawTrendCard data={hrRaw} view={hrView} onViewChange={setHrView} />
        ) : (
          <HeartRateTrendCard data={hrTrendData} view={hrView} onViewChange={setHrView} />
        )}
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-1">Time in heart rate zones</h2>
        <p className="text-xs text-tx-muted mb-3">Minutes spent in each zone, based on your estimated max HR.</p>
        {hrZonesData.length === 0 ? (
          <p className="text-sm text-tx-muted py-6 text-center">Not enough heart rate data synced yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hrZonesData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtDay} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `${v}m`} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d } }}
                formatter={(v: number, name: string) => [`${v} min`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {ZONE_FIELDS.map((f, i) => (
                <Bar
                  key={String(f.key)}
                  dataKey={f.key as string}
                  name={f.label}
                  stackId="zones"
                  fill={f.color}
                  isAnimationActive={false}
                  radius={i === ZONE_FIELDS.length - 1 ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-1">Recovery context</h2>
        <p className="text-xs text-tx-muted mb-3">Deep sleep and resting heart rate, week over week.</p>
        {contextData.length < 2 ? (
          <p className="text-sm text-tx-muted py-6 text-center">Not enough nights synced yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={contextData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false}
                tickFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }} />
              <YAxis yAxisId="mins" tick={AXIS_TICK} axisLine={false} tickLine={false} width={40}
                tickFormatter={(v: number) => `${Math.round(v)}m`} />
              <YAxis yAxisId="hr" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={['auto', 'auto']} />
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
