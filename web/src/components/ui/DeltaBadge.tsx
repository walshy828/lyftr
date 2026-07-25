import { ArrowUp, ArrowDown, Minus } from 'lucide-react'

// A week-over-week change chip. `goodDirection` decides which way reads as
// positive — for weight-loss / calorie goals a DOWN move is good, so the arrow
// direction and the color are decoupled from each other.
export default function DeltaBadge({
  value,
  goodDirection,
  suffix = '',
  decimals = 0,
  className = '',
}: {
  value: number
  goodDirection: 'up' | 'down' | 'none'
  suffix?: string
  decimals?: number
  className?: string
}) {
  const rounded = Number(value.toFixed(decimals))
  if (rounded === 0) {
    return (
      <span className={`inline-flex items-center gap-0.5 text-[11px] text-tx-muted tabular-nums ${className}`}>
        <Minus className="w-3 h-3" /> 0{suffix}
      </span>
    )
  }
  const up = rounded > 0
  const isGood =
    goodDirection === 'none' ? null : (up && goodDirection === 'up') || (!up && goodDirection === 'down')
  const color = isGood === null ? 'text-tx-secondary' : isGood ? 'text-success-400' : 'text-error-400'
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${color} ${className}`}>
      <Icon className="w-3 h-3" />
      {Math.abs(rounded).toLocaleString()}{suffix}
    </span>
  )
}
