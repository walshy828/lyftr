// Labeled progress bar for a macro / nutrient against its target. Extracted
// from Food.tsx so the dashboard and the food page share one implementation.
// Colors escalate amber (over target) → red (>125%) with an explicit "+X over"
// readout, since a capped bar can't otherwise distinguish "just over" from
// "way over."
//
// `kind="minimum"` is for nutrients where the target is a floor (protein):
// going past it is the goal, so it reads as a win in the macro's own colour
// rather than as a warning.
export default function MacroBar({
  value,
  target,
  color,
  label,
  unit = 'g',
  kind = 'target',
}: {
  value: number
  target: number
  color: string
  label: string
  unit?: string
  kind?: 'target' | 'minimum'
}) {
  const pct = target > 0 ? (value / target) * 100 : 0
  const over = pct > 100
  const floor = kind === 'minimum'
  const wayOver = !floor && pct > 125
  const barColor = floor ? color : wayOver ? '#ef4444' : over ? '#f59e0b' : color
  const textColor = floor ? (over ? 'text-move' : 'text-tx-primary') : wayOver ? 'text-error-400' : over ? 'text-amber-400' : 'text-tx-primary'
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-tx-muted">{label}</span>
        <span className={`text-xs font-semibold tabular-nums ${textColor}`}>
          {Math.round(value)}{unit}
          <span className="text-tx-muted font-normal"> / {target}{unit}</span>
          {over && <span className="ml-1">{floor ? `✓ +${Math.round(value - target)}${unit}` : `+${Math.round(value - target)}${unit} over`}</span>}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${Math.min(100, pct)}%`, background: barColor }} />
      </div>
    </div>
  )
}
