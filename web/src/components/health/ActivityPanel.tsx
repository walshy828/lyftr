import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Footprints, Bike, Waves, RotateCw, Activity, Zap, ArrowUpFromDot, HeartPulse, Flame, Timer, MapPin, Gauge } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Brush } from 'recharts'
import Loading from '../Loading'
import PeriodSelector from '../PeriodSelector'
import Sheet from '../ui/Sheet'
import DrillableTrendChart, { RawSeriesChart } from '../charts/DrillableTrendChart'
import { usePeriodFilter } from '../../hooks/usePeriodFilter'
import { useServerInfiniteList } from '../../hooks/useServerInfiniteList'
import { cardioAPI, healthMetricsAPI } from '../../services/api'
import { useSettingsStore, displayDistance, distanceShort } from '../../stores/settings'
import { TOOLTIP_STYLE, AXIS_TICK, GRID_STROKE, HR_ZONE_COLORS, CADENCE_COLOR } from '../../utils/chartTheme'
import * as types from '../../types'

const STEPS_COLOR = '#22d3ee'
const fmtDay = (d: string) => { try { return format(parseISO(d), 'MMM d') } catch { return d } }

const ACTIVITY_ICONS: Record<string, typeof Footprints> = {
  running: Footprints,
  walking: Footprints,
  cycling: Bike,
  swimming: Waves,
  rowing: RotateCw,
  elliptical: RotateCw,
  hiit: Zap,
  stair_climbing: ArrowUpFromDot,
  workout: Activity,
}

const ACTIVITY_LABELS: Record<string, string> = {
  running: 'Run',
  walking: 'Walk',
  cycling: 'Ride',
  swimming: 'Swim',
  rowing: 'Row',
  elliptical: 'Elliptical',
  hiit: 'HIIT',
  stair_climbing: 'Stair climbing',
  workout: 'Workout',
}

const ZONE_LABELS: { key: keyof types.HeartRateZoneMinutes; label: string; color: string }[] = [
  { key: 'below_zone1_mins', label: 'Below Z1', color: HR_ZONE_COLORS.belowZone1 },
  { key: 'zone1_minutes', label: 'Zone 1', color: HR_ZONE_COLORS.zone1 },
  { key: 'zone2_minutes', label: 'Zone 2', color: HR_ZONE_COLORS.zone2 },
  { key: 'zone3_minutes', label: 'Zone 3', color: HR_ZONE_COLORS.zone3 },
  { key: 'zone4_minutes', label: 'Zone 4', color: HR_ZONE_COLORS.zone4 },
  { key: 'zone5_minutes', label: 'Zone 5', color: HR_ZONE_COLORS.zone5 },
]

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Steps trend + cardio session drill-down (HR zones, cadence). Sync-derived,
 *  read-only, mirrors CardioPanel's history list. */
export default function ActivityPanel() {
  const { period, setPeriod, from, to, PERIODS } = usePeriodFilter('30d')
  const unit = useSettingsStore(s => s.settings.weight_unit)
  const [steps, setSteps] = useState<types.HealthMetricDailyStat[]>([])
  const [stepsLoading, setStepsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { items, sentinelRef, hasMore, loading, initialLoading } =
    useServerInfiniteList<types.CardioSession>({
      fetcher: (offset, limit) => cardioAPI.list({ offset, limit }),
    })

  useEffect(() => {
    setStepsLoading(true)
    healthMetricsAPI.daily('steps', from, to, 'sum').then(d => setSteps(d || [])).catch(() => setError('Failed to load step data')).finally(() => setStepsLoading(false))
  }, [from, to])

  const stepsData = useMemo(() => steps.map(d => ({ day: d.day, value: Math.round(d.value) })), [steps])
  const avgSteps = useMemo(() => {
    if (steps.length === 0) return null
    return Math.round(steps.reduce((a, b) => a + b.value, 0) / steps.length)
  }, [steps])

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<types.CardioSessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return }
    setDetailLoading(true)
    cardioAPI.zones(selectedId).then(setDetail).catch(() => setDetail(null)).finally(() => setDetailLoading(false))
  }, [selectedId])

  if (stepsLoading && initialLoading) return <Loading />

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
          <div>
            <h2 className="section-title">Steps</h2>
            {avgSteps != null && <p className="text-xs text-tx-muted mt-0.5">{avgSteps.toLocaleString()} avg/day</p>}
          </div>
          <PeriodSelector options={PERIODS} value={period} onChange={setPeriod} />
        </div>
        <DrillableTrendChart
          data={stepsData}
          xKey="day"
          emptyMessage="No step data synced yet."
          columns={[
            { key: 'day', label: 'Date', format: r => fmtDay(r.day) },
            { key: 'value', label: 'Steps', format: r => r.value.toLocaleString() },
          ]}
          granularFetcher={(from, to) => healthMetricsAPI.list('steps', from, to)}
          renderGranular={(rows: types.HealthMetric[]) => (
            <RawSeriesChart rows={rows} xKey="recorded_at" yKey="value" color={STEPS_COLOR} unit="steps" chartType="bar" />
          )}
          renderChart={(data, onBrushChange) => (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtDay} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d: string) => { try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d } }}
                  formatter={(v: number) => [v.toLocaleString(), 'Steps']}
                />
                <Bar dataKey="value" fill={STEPS_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Brush dataKey="day" height={18} stroke={STEPS_COLOR} travellerWidth={8} tickFormatter={fmtDay} onChange={onBrushChange} />
              </BarChart>
            </ResponsiveContainer>
          )}
        />
      </div>

      <h2 className="section-title px-1">Cardio sessions</h2>
      {items.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-tx-secondary font-medium">No cardio sessions yet</p>
          <p className="text-xs text-tx-muted mt-1">Tap a session for a heart-rate-zone breakdown once synced.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(session => {
            const Icon = ACTIVITY_ICONS[session.activity_type] ?? Footprints
            const label = session.activity_type === 'workout' && session.title
              ? session.title
              : ACTIVITY_LABELS[session.activity_type] ?? session.activity_type
            return (
              <button
                key={session.id}
                onClick={() => setSelectedId(session.id)}
                className="w-full card flex items-center p-4 gap-3 text-left active:scale-[0.99] transition-transform"
              >
                <div className="w-11 h-11 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-brand-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-tx-primary">{label}</p>
                    <span className="text-xs text-tx-muted">{format(new Date(session.started_at), 'MMM d, h:mm a')}</span>
                  </div>
                  <div className="flex items-center gap-x-3 mt-1 text-xs text-tx-muted flex-wrap">
                    <span className="flex items-center gap-1"><Timer className="w-3 h-3" />{formatDuration(session.duration_seconds)}</span>
                    {session.distance_meters > 0 && (
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{displayDistance(session.distance_meters, unit).toFixed(2)} {distanceShort(unit)}</span>
                    )}
                    {session.avg_heart_rate > 0 && (
                      <span className="flex items-center gap-1"><HeartPulse className="w-3 h-3" />{session.avg_heart_rate} bpm</span>
                    )}
                    {session.avg_cadence != null && (
                      <span className="flex items-center gap-1" style={{ color: CADENCE_COLOR }}><Gauge className="w-3 h-3" />{Math.round(session.avg_cadence)} rpm</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
      <div ref={sentinelRef} />
      {hasMore && loading && <p className="text-center text-xs text-tx-muted py-2">Loading more…</p>}

      <Sheet
        isOpen={selectedId != null}
        onClose={() => setSelectedId(null)}
        title="Session detail"
        icon={<HeartPulse className="w-4 h-4 text-brand-500" />}
      >
        <div className="p-5">
          {detailLoading || !detail ? (
            <Loading />
          ) : (
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="card p-3">
                    <p className="stat-label mb-1">Avg HR</p>
                    <p className="stat-value text-xl">{detail.avg_heart_rate > 0 ? detail.avg_heart_rate : '—'}<span className="text-xs text-tx-muted font-normal ml-1">bpm</span></p>
                  </div>
                  <div className="card p-3">
                    <p className="stat-label mb-1">Max HR</p>
                    <p className="stat-value text-xl">{detail.max_observed_bpm ? detail.max_observed_bpm : '—'}<span className="text-xs text-tx-muted font-normal ml-1">bpm</span></p>
                  </div>
                  <div className="card p-3">
                    <p className="stat-label mb-1 flex items-center gap-1"><Flame className="w-3 h-3" />Calories</p>
                    <p className="stat-value text-xl">{Math.round(detail.calories)}</p>
                  </div>
                  {detail.avg_cadence != null && (
                    <div className="card p-3">
                      <p className="stat-label mb-1 flex items-center gap-1" style={{ color: CADENCE_COLOR }}><Gauge className="w-3 h-3" />Cadence</p>
                      <p className="stat-value text-xl">{Math.round(detail.avg_cadence)}<span className="text-xs text-tx-muted font-normal ml-1">rpm</span></p>
                    </div>
                  )}
                </div>

                {detail.zones && (
                  <div>
                    <p className="text-[11px] text-tx-muted mb-2">Time in heart-rate zone</p>
                    <div className="space-y-1.5">
                      {(() => {
                        const zones = detail.zones
                        const maxMins = Math.max(...ZONE_LABELS.map(zl => zones[zl.key] as number || 0))
                        return ZONE_LABELS.map(z => {
                          const mins = zones[z.key] as number
                          if (!mins) return null
                          return (
                            <div key={z.key} className="flex items-center gap-2">
                              <span className="w-16 text-[11px] text-tx-muted flex-shrink-0">{z.label}</span>
                              <div className="flex-1 h-2.5 rounded-full bg-surface-overlay overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (mins / maxMins) * 100)}%`, backgroundColor: z.color }} />
                              </div>
                              <span className="w-10 text-[11px] text-tx-muted text-right flex-shrink-0">{Math.round(mins)}m</span>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
      </Sheet>
    </div>
  )
}
