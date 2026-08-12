import { AlertTriangle, Info, CalendarClock } from 'lucide-react'
import type { BPNudge } from '../../types'

interface Props {
  nudges: BPNudge[]
  /** How many to show. The list is server-ranked, so this is a simple take-N. */
  limit?: number
}

/**
 * Capture guidance — the "when and how should I measure" half of the feature.
 *
 * Every nudge here is computed deterministically by EvaluateBPProtocol in the
 * backend, so this card reads identically on a server with no AI provider. The
 * server ranks them, so the UI never re-decides what matters most.
 */

const STYLES: Record<BPNudge['severity'], { wrap: string; Icon: typeof Info }> = {
  urgent: {
    wrap: 'border-red-600/40 bg-red-600/15 text-red-300',
    Icon: AlertTriangle,
  },
  warn: {
    wrap: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    Icon: AlertTriangle,
  },
  info: {
    wrap: 'border-surface-border bg-surface-overlay text-tx-secondary',
    Icon: CalendarClock,
  },
}

export default function BPProtocolCard({ nudges, limit = 2 }: Props) {
  if (!nudges.length) return null

  // An urgent nudge is never truncated away by the limit.
  const urgent = nudges.filter(n => n.severity === 'urgent')
  const rest = nudges.filter(n => n.severity !== 'urgent').slice(0, Math.max(0, limit - urgent.length))
  const shown = [...urgent, ...rest]

  return (
    <div className="space-y-2" data-testid="bp-nudges">
      {shown.map(n => {
        const { wrap, Icon } = STYLES[n.severity]
        return (
          <div
            key={n.key}
            data-nudge-key={n.key}
            role={n.severity === 'urgent' ? 'alert' : undefined}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${wrap}`}
          >
            <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{n.title}</p>
              <p className="text-xs mt-0.5 leading-relaxed opacity-90">{n.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
