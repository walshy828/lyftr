import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Moon, RefreshCw } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import {
  ComposedChart, Bar, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  Brush,
} from 'recharts'
import Loading from '../Loading'
import PeriodSelector from '../PeriodSelector'
import Sheet from '../ui/Sheet'
import DrillableTrendChart from '../charts/DrillableTrendChart'
import { usePeriodFilter } from '../../hooks/usePeriodFilter'
import { useCompanionSync } from '../../hooks/useCompanionSync'
import { sleepAPI } from '../../services/api'
import { TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE, SLEEP_STAGE_COLORS } from '../../utils/chartTheme'
import * as types from '../../types'

const HRV_COLOR = '#8b5cf6'
const HR_COLOR = '#ef4444'

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Sleep sessions arrive read-only from a companion device (Health Connect via
 *  the Android app) — no manual log form, only trend + history + drill-down. */
export default function SleepPanel() {
  const { period, setPeriod, from, to, PERIODS } = usePeriodFilter('30d')
  const [trend, setTrend] = useState<types.SleepTrendPoint[]>([])
  const [trendLoading, setTrendLoading] = useState(true)
  const [sessions, setSessions] = useState<types.SleepSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<types.SleepSessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = () => {
    setTrendLoading(true)
    sleepAPI.trend(from, to, 'week').then(d => setTrend(d || [])).catch(() => {}).finally(() => setTrendLoading(false))
    setSessionsLoading(true)
    // Backend already returns sessions newest-first (ORDER BY started_at DESC) —
    // render as-is, newest on top.
    sleepAPI.list(from, to).then(d => setSessions(d || [])).catch(() => {}).finally(() => setSessionsLoading(false))
  }

  useEffect(load, [from, to])

  const { trigger: triggerSync, status: syncStatus } = useCompanionSync(load)

  useEffect(() => {
    if (syncStatus !== 'unavailable') return
    setError('Lyftr Companion app not found — install it on this phone to sync sleep data')
    const timeout = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timeout)
  }, [syncStatus])

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return }
    setDetailLoading(true)
    sleepAPI.detail(selectedId).then(setDetail).catch(() => setDetail(null)).finally(() => setDetailLoading(false))
  }, [selectedId])

  // Trend data is chronological (oldest → newest) for the chart; DrillableTrendChart
  // reverses it for the table view so that reads newest-first.
  const trendData = useMemo(
    () => trend.map(t => ({
      bucket: t.bucket,
      Awake: Math.round(t.avg_awake_minutes),
      Light: Math.round(t.avg_light_minutes),
      Deep: Math.round(t.avg_deep_minutes),
      REM: Math.round(t.avg_rem_minutes),
      restingHR: t.avg_resting_hr != null ? Math.round(t.avg_resting_hr) : null,
    })),
    [trend],
  )

  const fmtBucket = (d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }

  // Sleep-session detail: stage timeline + HR/HRV plotted on a shared, labeled
  // clock-time axis instead of raw dumped numbers.
  const detailTimeline = useMemo(() => {
    if (!detail) return null
    const stages = detail.stages ?? []
    const hr = detail.heart_rate_samples ?? []
    const hrv = detail.hrv_readings ?? []
    if (stages.length === 0 && hr.length === 0) return null
    const start = new Date(detail.started_at).getTime()
    const end = new Date(detail.ended_at).getTime()
    const span = Math.max(end - start, 1)

    const stageSegments = stages.map(s => {
      const sStart = new Date(s.started_at).getTime()
      const sEnd = new Date(s.ended_at).getTime()
      return {
        stage: s.stage_type,
        leftPct: ((sStart - start) / span) * 100,
        widthPct: Math.max(((sEnd - sStart) / span) * 100, 0.3),
      }
    })

    const hrPoints = hr.map(s => ({ t: new Date(s.recorded_at).getTime(), bpm: s.bpm })).sort((a, b) => a.t - b.t)
    const hrvPoints = hrv.map(r => ({ t: new Date(r.recorded_at).getTime(), value: Math.round(r.value) })).sort((a, b) => a.t - b.t)

    // Hourly tick marks across the session span, for both the stage bar and the HR chart.
    const ticks: number[] = []
    const firstTick = new Date(start)
    firstTick.setMinutes(0, 0, 0)
    if (firstTick.getTime() < start) firstTick.setHours(firstTick.getHours() + 1)
    for (let t = firstTick.getTime(); t <= end; t += 3600_000) ticks.push(t)
    if (ticks.length === 0) { ticks.push(start, end) }

    return { stageSegments, hrPoints, hrvPoints, start, end, span, ticks }
  }, [detail])

  if (trendLoading && sessionsLoading) return <Loading />

  return (
    <div className="space-y-5">
      {error && (
        <div className="alert-error" role="alert" aria-live="polite">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h2 className="section-title">Sleep trend</h2>
          <PeriodSelector options={PERIODS} value={period} onChange={setPeriod} />
        </div>

        <DrillableTrendChart
          data={trendData}
          xKey="bucket"
          emptyMessage="Not enough nights synced yet for a trend."
          columns={[
            { key: 'bucket', label: 'Week of', format: r => fmtBucket(r.bucket) },
            { key: 'Deep', label: 'Deep (m)' },
            { key: 'REM', label: 'REM (m)' },
            { key: 'Light', label: 'Light (m)' },
            { key: 'Awake', label: 'Awake (m)' },
            { key: 'restingHR', label: 'Resting HR', format: r => r.restingHR != null ? `${r.restingHR} bpm` : '—' },
          ]}
          granularFetcher={(fromBucket, toBucket) => sleepAPI.list(fromBucket, toBucket)}
          renderGranular={(rows: types.SleepSession[]) => (
            rows.length === 0 ? (
              <p className="text-xs text-tx-muted py-2 text-center">No individual sessions in this range.</p>
            ) : (
              <div className="space-y-1.5">
                {rows.map(s => {
                  const durationMin = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className="w-full flex items-center justify-between text-xs bg-surface-overlay rounded-lg px-3 py-2 hover:bg-surface-muted transition-colors text-left"
                    >
                      <span className="text-tx-primary font-medium">{format(new Date(s.started_at), 'EEE, MMM d')}</span>
                      <span className="text-tx-muted">{formatMinutes(durationMin)}</span>
                    </button>
                  )
                })}
              </div>
            )
          )}
          renderChart={(data, onBrushChange) => (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtBucket} />
                  <YAxis yAxisId="mins" tick={AXIS_TICK} axisLine={false} tickLine={false} width={40}
                    tickFormatter={(v: number) => `${Math.round(v / 60)}h`} />
                  <YAxis yAxisId="hr" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtBucket} />
                  <Bar yAxisId="mins" dataKey="Awake" stackId="s" fill={SLEEP_STAGE_COLORS.awake} isAnimationActive={false} />
                  <Bar yAxisId="mins" dataKey="Light" stackId="s" fill={SLEEP_STAGE_COLORS.light} isAnimationActive={false} />
                  <Bar yAxisId="mins" dataKey="REM" stackId="s" fill={SLEEP_STAGE_COLORS.rem} isAnimationActive={false} />
                  <Bar yAxisId="mins" dataKey="Deep" stackId="s" fill={SLEEP_STAGE_COLORS.deep} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Line yAxisId="hr" dataKey="restingHR" name="Resting HR" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Brush dataKey="bucket" height={18} stroke="#6366f1" travellerWidth={8} tickFormatter={fmtBucket} onChange={onBrushChange} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-3 mt-2 flex-wrap">
                {(['deep', 'rem', 'light', 'awake'] as const).map(k => (
                  <span key={k} className="flex items-center gap-1.5 text-[11px] text-tx-muted capitalize">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: SLEEP_STAGE_COLORS[k] }} />
                    {k}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-[11px] text-tx-muted">
                  <span className="w-2.5 h-0.5 rounded-full bg-error-400" />
                  Resting HR
                </span>
              </div>
              <p className="text-[11px] text-tx-muted text-center mt-1">
                Drag on the mini-timeline above to see the nights behind any stretch.
              </p>
            </>
          )}
        />
      </div>

      <div className="flex items-center justify-between px-1">
        <h2 className="section-title">History</h2>
        <button
          onClick={triggerSync}
          disabled={syncStatus === 'triggering'}
          className="p-2 hover:bg-brand-500/10 rounded-lg transition-colors"
          aria-label="Refresh sleep sessions from companion app"
        >
          <RefreshCw className={`w-4 h-4 text-tx-secondary ${syncStatus === 'triggering' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-tx-secondary font-medium">No sleep sessions yet</p>
          <p className="text-xs text-tx-muted mt-1">
            Nights recorded by your watch sync here automatically once the Lyftr companion app is
            connected to Health Connect.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => {
            const durationMin = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className="w-full card flex items-center p-4 gap-3 text-left active:scale-[0.99] transition-transform"
              >
                <div className="w-11 h-11 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                  <Moon className="w-5 h-5 text-brand-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-tx-primary">
                    {format(new Date(s.started_at), 'MMM d, yyyy')}
                  </p>
                  <p className="text-xs text-tx-muted mt-0.5">
                    {format(new Date(s.started_at), 'h:mm a')} – {format(new Date(s.ended_at), 'h:mm a')} · {formatMinutes(durationMin)}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Sheet
        isOpen={selectedId != null}
        onClose={() => setSelectedId(null)}
        title="Sleep session"
        icon={<Moon className="w-4 h-4 text-brand-500" />}
      >
        <div className="p-5">
          {detailLoading || !detail ? (
            <Loading />
          ) : !detailTimeline ? (
            <p className="text-sm text-tx-muted py-6 text-center">No detailed data captured for this session.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-tx-muted">
                {format(new Date(detail.started_at), 'MMM d, h:mm a')} – {format(new Date(detail.ended_at), 'h:mm a')}
              </p>

              {/* Stage timeline — a proportional bar with hourly clock labels beneath it. */}
              <div>
                <p className="text-[11px] text-tx-muted mb-1">Sleep stages</p>
                <div className="relative h-6 rounded-lg overflow-hidden bg-surface-overlay flex">
                  {detailTimeline.stageSegments.map((seg, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0"
                      style={{
                        left: `${seg.leftPct}%`,
                        width: `${seg.widthPct}%`,
                        backgroundColor: SLEEP_STAGE_COLORS[seg.stage as keyof typeof SLEEP_STAGE_COLORS] ?? '#94a3b8',
                      }}
                    />
                  ))}
                </div>
                <div className="relative h-4 mt-1">
                  {detailTimeline.ticks.map(t => (
                    <span
                      key={t}
                      className="absolute -translate-x-1/2 text-[10px] text-tx-muted whitespace-nowrap"
                      style={{ left: `${((t - detailTimeline.start) / detailTimeline.span) * 100}%` }}
                    >
                      {format(new Date(t), 'h a')}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  {(['deep', 'rem', 'light', 'awake'] as const).map(k => (
                    <span key={k} className="flex items-center gap-1.5 text-[11px] text-tx-muted capitalize">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: SLEEP_STAGE_COLORS[k] }} />
                      {k}
                    </span>
                  ))}
                </div>
              </div>

              {detailTimeline.hrPoints.length > 1 && (
                <div>
                  <p className="text-[11px] text-tx-muted mb-1">
                    Heart rate{detailTimeline.hrvPoints.length > 0 ? ' & HRV' : ''}
                  </p>
                  <ResponsiveContainer width="100%" height={140}>
                    <ComposedChart margin={{ top: 4, right: detailTimeline.hrvPoints.length > 0 ? 28 : 4, bottom: 0, left: -22 }}>
                      <XAxis
                        dataKey="t" type="number" domain={[detailTimeline.start, detailTimeline.end]}
                        ticks={detailTimeline.ticks} tick={AXIS_TICK} axisLine={false} tickLine={false}
                        tickFormatter={(t: number) => format(new Date(t), 'h a')}
                      />
                      <YAxis yAxisId="hr" tick={AXIS_TICK} axisLine={false} tickLine={false} width={30} domain={['auto', 'auto']} />
                      {detailTimeline.hrvPoints.length > 0 && (
                        <YAxis yAxisId="hrv" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} domain={['auto', 'auto']} />
                      )}
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelFormatter={(t: number) => format(new Date(t), 'h:mm a')}
                        formatter={(v: number, name: string) => [name === 'HRV' ? `${v} ms` : `${v} bpm`, name]}
                      />
                      <Line yAxisId="hr" data={detailTimeline.hrPoints} dataKey="bpm" name="HR" stroke={HR_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      {detailTimeline.hrvPoints.length > 0 && (
                        <Scatter yAxisId="hrv" data={detailTimeline.hrvPoints} dataKey="value" name="HRV" fill={HRV_COLOR} />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                  {detailTimeline.hrvPoints.length > 0 && (
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1.5 text-[11px] text-tx-muted">
                        <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: HR_COLOR }} /> Heart rate
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-tx-muted">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: HRV_COLOR }} /> HRV
                      </span>
                    </div>
                  )}
                </div>
              )}

              {(detail.resting_hr_readings?.length ?? 0) > 0 && (
                <div className="flex items-center justify-between text-xs bg-surface-overlay rounded-lg px-3 py-2.5">
                  <span className="text-tx-muted">Resting HR (this session)</span>
                  <span className="font-semibold text-tx-primary">
                    {Math.round(average(detail.resting_hr_readings.map(r => r.value))!)} bpm
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </Sheet>
    </div>
  )
}
