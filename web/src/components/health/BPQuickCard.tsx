import { useState, useEffect, useCallback } from 'react'
import { HeartPulse, Plus, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { bloodPressureAPI } from '../../services/api'
import { BP_CATEGORIES, BP_CRISIS_WARNING, formatBP } from '../../utils/bloodPressure'
import BPEntrySheet from '../BPEntrySheet'
import SectionHeader from '../ui/SectionHeader'
import * as types from '../../types'

const RECENT_LIMIT = 5
/** How far back a crisis reading keeps the banner up. */
const CRISIS_WINDOW_DAYS = 7

/**
 * Blood pressure capture, as a self-contained card.
 *
 * This currently sits at the bottom of the Weight page so capture can ship
 * before the health hub exists; it moves wholesale into BloodPressurePanel
 * once /health lands, which is why it owns its own fetching rather than
 * taking data as props.
 */
export default function BPQuickCard() {
  const [recent, setRecent] = useState<types.BloodPressureLog[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(() => {
    bloodPressureAPI.list({ limit: RECENT_LIMIT })
      .then(setRecent)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const latest = recent[0]
  const latestMeta = latest ? BP_CATEGORIES[latest.category] : null

  // The crisis banner is driven entirely by the server-stamped category, so it
  // shows identically whether or not an AI provider is configured.
  const crisisCutoff = Date.now() - CRISIS_WINDOW_DAYS * 86_400_000
  const hasRecentCrisis = recent.some(
    r => r.category === 'crisis' && new Date(r.logged_at).getTime() >= crisisCutoff,
  )

  return (
    <div className="card p-5">
      <SectionHeader
        icon={HeartPulse}
        title="Blood Pressure"
        right={
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="btn-secondary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Log
          </button>
        }
        className="mb-3"
      />

      {hasRecentCrisis && (
        <div
          className="flex items-start gap-3 rounded-xl border border-red-600/40 bg-red-600/15 px-4 py-3 text-sm text-red-300 mb-3"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{BP_CRISIS_WARNING}</p>
        </div>
      )}

      {loading ? (
        <div className="h-16 rounded-xl bg-surface-overlay animate-pulse" />
      ) : !latest ? (
        <p className="text-sm text-tx-muted">
          No readings yet. Log one to start tracking where you fall against the
          standard ranges.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-display font-bold text-tx-primary tabular-nums">
              {formatBP(latest.systolic, latest.diastolic)}
            </span>
            <span className="text-sm text-tx-muted">mmHg</span>
            {latestMeta && (
              <span className={`badge border ${latestMeta.chip}`}>{latestMeta.label}</span>
            )}
          </div>
          <p className="text-xs text-tx-muted mt-1">
            {format(new Date(latest.logged_at), 'MMM d, h:mm a')}
            {latest.pulse ? ` · ${latest.pulse} bpm` : ''}
          </p>

          {recent.length > 1 && (
            <div className="mt-4 space-y-1.5">
              {recent.slice(1).map(r => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span className="text-tx-secondary tabular-nums">
                    {formatBP(r.systolic, r.diastolic)}
                  </span>
                  <span className="text-tx-muted">
                    {format(new Date(r.logged_at), 'MMM d, h:mm a')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Single readings swing 5-10 mmHg on nothing at all, so the number
              above is a data point, not a verdict. Trends and averages arrive
              with the health hub. */}
          <p className="text-[11px] text-tx-muted mt-4 leading-relaxed">
            Home readings inform a conversation with your doctor — they don't
            replace one. Categories follow the ACC/AHA 2017 guideline.
          </p>
        </>
      )}

      <BPEntrySheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSuccess={() => load()}
      />
    </div>
  )
}
