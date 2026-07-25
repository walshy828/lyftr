// Labeled progress bar for a macro / nutrient against its target. Extracted
// from Food.tsx so the dashboard and the food page share one implementation.
// Colors escalate amber (over target) → red (>125%) with an explicit "+X over"
// readout, since a capped bar can't otherwise distinguish "just over" from
// "way over."
export default function MacroBar({
  value,
  target,
  color,
  label,
  unit = 'g',
}: {
  value: number
  target: number
  color: string
  label: string
  unit?: string
}) {
  const pct = target > 0 ? (value / target) * 100 : 0
  const over = pct > 100
  const wayOver = pct > 125
  const barColor = wayOver ? '#ef4444' : over ? '#f59e0b' : color
  const textColor = wayOver ? 'text-error-400' : over ? 'text-amber-400' : 'text-tx-primary'
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-tx-muted">{label}</span>
        <span className={`text-xs font-semibold tabular-nums ${textColor}`}>
          {Math.round(value)}{unit}
          <span className="text-tx-muted font-normal"> / {target}{unit}</span>
          {over && <span className="ml-1">+{Math.round(value - target)}{unit} over</span>}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${Math.min(100, pct)}%`, background: barColor }} />
      </div>
    </div>
  )
}
