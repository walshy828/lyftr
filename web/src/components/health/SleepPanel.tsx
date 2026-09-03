import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Moon, RefreshCw, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  LineChart,
} from 'recharts'
import Loading from '../Loading'
import PeriodSelector from '../PeriodSelector'
import { usePeriodFilter } from '../../hooks/usePeriodFilter'
import { useCompanionSync } from '../../hooks/useCompanionSync'
import { sleepAPI } from '../../services/api'
import { TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE, SLEEP_STAGE_COLORS } from '../../utils/chartTheme'
import * as types from '../../types'

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
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
    sleepAPI.list(from, to).then(d => setSessions((d || []).slice().reverse())).catch(() => {}).finally(() => setSessionsLoading(false))
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

  const detailTimeline = useMemo(() => {
    if (!detail) return null
    const stages = detail.stages ?? []
    const hr = detail.heart_rate_samples ?? []
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
    const hrPoints = hr.map(s => ({
      t: Math.round(((new Date(s.recorded_at).getTime() - start) / 60000)),
      bpm: s.bpm,
    })).sort((a, b) => a.t - b.t)
    return { stageSegments, hrPoints }
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

        {trendData.length < 2 ? (
          <p className="text-sm text-tx-muted py-6 text-center">Not enough nights synced yet for a trend.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false}
                  tickFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }} />
                <YAxis yAxisId="mins" tick={AXIS_TICK} axisLine={false} tickLine={false} width={40}
                  tickFormatter={(v: number) => `${Math.round(v / 60)}h`} />
                <YAxis yAxisId="hr" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }} />
                <Bar yAxisId="mins" dataKey="Awake" stackId="s" fill={SLEEP_STAGE_COLORS.awake} isAnimationActive={false} />
                <Bar yAxisId="mins" dataKey="Light" stackId="s" fill={SLEEP_STAGE_COLORS.light} isAnimationActive={false} />
                <Bar yAxisId="mins" dataKey="REM" stackId="s" fill={SLEEP_STAGE_COLORS.rem} isAnimationActive={false} />
                <Bar yAxisId="mins" dataKey="Deep" stackId="s" fill={SLEEP_STAGE_COLORS.deep} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="hr" dataKey="restingHR" name="Resting HR" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
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
          </>
        )}
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

      {selectedId != null && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setSelectedId(null)}>
          <div className="card w-full sm:max-w-lg max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="section-title">Sleep session</h3>
              <button onClick={() => setSelectedId(null)} className="p-1.5 hover:bg-surface-muted rounded-lg transition-colors" aria-label="Close">
                <X className="w-4 h-4 text-tx-muted" />
              </button>
            </div>

            {detailLoading || !detail ? (
              <Loading />
            ) : !detailTimeline ? (
              <p className="text-sm text-tx-muted py-6 text-center">No detailed data captured for this session.</p>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-tx-muted">
                  {format(new Date(detail.started_at), 'MMM d, h:mm a')} – {format(new Date(detail.ended_at), 'h:mm a')}
                </p>

                {/* Stage timeline — a simple proportional bar, not a full chart library
                    render, since the goal is "what happened when" at a glance. */}
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
                </div>

                {detailTimeline.hrPoints.length > 1 && (
                  <div>
                    <p className="text-[11px] text-tx-muted mb-1">Heart rate</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={detailTimeline.hrPoints} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                        <XAxis dataKey="t" tick={false} axisLine={false} tickLine={false} />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} bpm`, 'HR']} labelFormatter={() => ''} />
                        <Line dataKey="bpm" stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {(detail.hrv_readings?.length ?? 0) > 0 && (
                  <p className="text-xs text-tx-muted">
                    HRV: {detail.hrv_readings.map(r => Math.round(r.value)).join(', ')} ms
                  </p>
                )}
                {(detail.resting_hr_readings?.length ?? 0) > 0 && (
                  <p className="text-xs text-tx-muted">
                    Resting HR: {detail.resting_hr_readings.map(r => Math.round(r.value)).join(', ')} bpm
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
