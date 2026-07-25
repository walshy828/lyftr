import { CheckCircle2, AlertTriangle } from 'lucide-react'
import type { Insight } from '../../utils/dashboardMetrics'

// Renders the "doing well ✓ / focus △" bullets. Green check for wins, amber
// triangle for focus areas — tone carries an icon + color, never color alone.
export default function InsightList({ items }: { items: Insight[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => {
        const good = it.tone === 'good'
        const Icon = good ? CheckCircle2 : AlertTriangle
        return (
          <li key={i} className="flex items-start gap-2 text-xs">
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${good ? 'text-success-400' : 'text-amber-400'}`} />
            <span className="text-tx-secondary">
              <span className={`font-medium ${good ? 'text-success-400' : 'text-amber-400'}`}>
                {good ? 'Doing well' : 'Focus'}
              </span>
              {' — '}{it.text}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
