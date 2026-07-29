import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

// One pillar of the "This Week" scorecard: a headline metric with an optional
// unit, a context sub-line, an icon, and a slot for a DeltaBadge (or any
// trailing node). Uses the shared .stat-value / .stat-label classes so every
// tile reads as one system.
//
// Pass `to` to make the whole tile a tap target that drills into the section
// the metric summarises.
export default function StatTile({
  label,
  value,
  unit,
  sub,
  icon: Icon,
  delta,
  accent = 'var(--tx-muted)',
  to,
  linkLabel,
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  icon?: LucideIcon
  delta?: ReactNode
  accent?: string
  to?: string
  linkLabel?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-1">
        {/* Tighter type below sm — three tiles across a phone leaves ~60px of
            label width, which full-size uppercase tracking overruns. */}
        <span className="stat-label text-[10px] tracking-wide sm:text-xs sm:tracking-wider truncate">{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accent }} />}
      </div>
      <p className="stat-value text-2xl leading-none">
        {value}
        {unit && <span className="text-xs text-tx-muted font-normal ml-0.5">{unit}</span>}
      </p>
      {/* Wraps rather than clips when the delta and sub-line can't share a row. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-h-[16px]">
        {delta}
        {sub && <span className="text-[10px] sm:text-[11px] text-tx-muted truncate max-w-full">{sub}</span>}
      </div>
    </>
  )

  const shape = 'p-2.5 sm:p-3 flex flex-col gap-1.5 min-w-0'

  if (to) {
    return (
      <Link
        to={to}
        aria-label={linkLabel ?? `${label} — view details`}
        className={`card-interactive ${shape} active:scale-[0.98] focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
                    focus-visible:ring-offset-surface-base`}
      >
        {body}
      </Link>
    )
  }

  return <div className={`card ${shape}`}>{body}</div>
}
