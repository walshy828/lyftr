import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { HeartPulse, Plus, TrendingDown, TrendingUp, Minus, Sparkles, ChevronRight } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { bloodPressureAPI } from '../../services/api'
import { BP_CATEGORIES, formatBP } from '../../utils/bloodPressure'
import BPEntrySheet from '../BPEntrySheet'
import BPCategoryGauge from './BPCategoryGauge'
import BPTrendChart from './BPTrendChart'
import BPProtocolCard from './BPProtocolCard'
import SectionHeader from '../ui/SectionHeader'
import EmptyState from '../ui/EmptyState'
import SegmentedControl from '../ui/SegmentedControl'
import * as types from '../../types'

const WINDOW_LABELS: Record<number, string> = { 7: '7 days', 30: '30 days', 90: '90 days' }

const TREND_META = {
  improving: { label: 'Improving', Icon: TrendingDown, cls: 'text-success-400' },
  worsening: { label: 'Rising', Icon: TrendingUp, cls: 'text-error-400' },
  stable: { label: 'Steady', Icon: Minus, cls: 'text-tx-secondary' },
} as const

export default function BloodPressurePanel() {
  const [stats, setStats] = useState<types.BPStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [windowDays, setWindowDays] = useState<'7' | '30' | '90'>('30')

  const load = useCallback(() => {
    bloodPressureAPI.stats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const logButton = (
    <button type="button" onClick={() => setSheetOpen(true)} className="btn-primary btn-sm">
      <Plus className="w-3.5 h-3.5" />
      Log Reading
    </button>
  )

  const sheet = (
    <BPEntrySheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} onSuccess={load} />
  )

  if (loading) {
    return <div className="h-64 rounded-2xl bg-surface-overlay animate-pulse" />
  }

  if (!stats || stats.total_readings === 0) {
    return (
      <>
        <div className="card p-5">
          <EmptyState
            icon={HeartPulse}
            title="No readings yet"
            subtitle="Log a reading to see where you fall against the standard ranges, how you're trending, and when to measure next."
            action={logButton}
          />
        </div>
        {/* Even with no data the protocol card has something useful to say. */}
        <div className="mt-3">
          <BPProtocolCard nudges={stats?.nudges ?? []} />
        </div>
        {sheet}
      </>
    )
  }

  const selected = stats.windows.find(w => String(w.days) === windowDays) ?? stats.windows[0]
  const window30 = stats.windows.find(w => w.days === 30) ?? selected
  const { latest } = stats
  const latestMeta = latest ? BP_CATEGORIES[latest.category] : null
  const trend = stats.trend.label ? TREND_META[stats.trend.label] : null

  return (
    <div className="space-y-4">
      {/* Guidance first — a nudge about *how* you're measuring changes how much
          the numbers below are worth. */}
      <BPProtocolCard nudges={stats.nudges} />

      <div className="card p-5">
        <SectionHeader icon={HeartPulse} title="Latest Reading" right={logButton} className="mb-3" />

        {latest && latestMeta && (
          <>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-4xl font-display font-bold text-tx-primary tabular-nums">
                {formatBP(latest.systolic, latest.diastolic)}
              </span>
              <span className="text-sm text-tx-muted">mmHg</span>
              <span className={`badge border ${latestMeta.chip}`}>{latestMeta.label}</span>
            </div>
            <p className="text-xs text-tx-muted mt-1">
              {format(parseISO(latest.logged_at), 'EEE, MMM d · h:mm a')}
              {latest.pulse ? ` · ${latest.pulse} bpm` : ''}
              {latest.context ? ` · ${latest.context.replace('_', '-')}` : ''}
            </p>
          </>
        )}
      </div>

      <div className="card p-5">
        <SectionHeader
          icon={HeartPulse}
          title="Your Average"
          right={
            <SegmentedControl
              options={[
                { value: '7', label: '7d' },
                { value: '30', label: '30d' },
                { value: '90', label: '90d' },
              ] as const}
              value={windowDays}
              onChange={setWindowDays}
              size="sm"
            />
          }
          className="mb-3"
        />

        {selected.days_with_data === 0 ? (
          <p className="text-sm text-tx-muted">
            No readings in the last {WINDOW_LABELS[selected.days]}.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-3 flex-wrap mb-4">
              <span className="text-3xl font-display font-bold text-tx-primary tabular-nums">
                {formatBP(selected.avg_systolic, selected.avg_diastolic)}
              </span>
              <span className="text-xs text-tx-muted">
                across {selected.days_with_data} {selected.days_with_data === 1 ? 'day' : 'days'}
                {' · '}{selected.readings} {selected.readings === 1 ? 'reading' : 'readings'}
              </span>
              {trend && (
                <span className={`flex items-center gap-1 text-xs font-medium ${trend.cls}`}>
                  <trend.Icon className="w-3.5 h-3.5" />
                  {trend.label}
                </span>
              )}
            </div>

            {selected.category && (
              <BPCategoryGauge
                avgSystolic={selected.avg_systolic}
                latestSystolic={latest?.systolic}
                category={selected.category}
              />
            )}
          </>
        )}
      </div>

      <div className="card p-4 min-w-0">
        <SectionHeader icon={HeartPulse} title="Trend" className="mb-2" />
        <BPTrendChart days={stats.daily} />
        {stats.trend.label && stats.trend.points >= 3 && (
          <p className="text-xs text-tx-muted text-center mt-2">
            {stats.trend.sys_per_30d < 0 ? 'Down' : 'Up'}{' '}
            {Math.abs(stats.trend.sys_per_30d).toFixed(0)} mmHg systolic per 30 days,
            fitted across {stats.trend.points} days.
          </p>
        )}
      </div>

      {/* The AI report is an explicit, user-triggered destination — never
          generated on page load. */}
      <Link to="/stats/bp/insight" className="card card-interactive p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-brand-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-tx-primary">Blood Pressure Insight</p>
          <p className="text-xs text-tx-muted mt-0.5">
            How your training, weight and sodium relate to these numbers — and what to do next.
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-tx-muted flex-shrink-0" />
      </Link>

      <p className="text-[11px] text-tx-muted leading-relaxed px-1">
        Home readings inform a conversation with your doctor — they don't replace
        one. Categories follow the ACC/AHA 2017 guideline and are based on your
        average, not any single reading.
        {window30.worst_category === 'stage2' || window30.worst_category === 'crisis'
          ? ' Readings in this range are worth raising with a clinician.'
          : ''}
      </p>

      {sheet}
    </div>
  )
}
