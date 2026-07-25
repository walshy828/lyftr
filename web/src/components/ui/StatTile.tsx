import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// One pillar of the "This Week" scorecard: a headline metric with an optional
// unit, a context sub-line, an icon, and a slot for a DeltaBadge (or any
// trailing node). Uses the shared .stat-value / .stat-label classes so every
// tile reads as one system.
export default function StatTile({
  label,
  value,
  unit,
  sub,
  icon: Icon,
  delta,
  accent = 'var(--tx-muted)',
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  icon?: LucideIcon
  delta?: ReactNode
  accent?: string
}) {
  return (
    <div className="card p-3 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between gap-1">
        <span className="stat-label truncate">{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accent }} />}
      </div>
      <p className="stat-value text-2xl leading-none">
        {value}
        {unit && <span className="text-xs text-tx-muted font-normal ml-0.5">{unit}</span>}
      </p>
      <div className="flex items-center gap-1.5 min-h-[16px]">
        {delta}
        {sub && <span className="text-[11px] text-tx-muted truncate">{sub}</span>}
      </div>
    </div>
  )
}
