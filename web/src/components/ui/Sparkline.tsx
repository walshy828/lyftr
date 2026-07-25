// Tiny inline SVG sparkline. Generalized from the dashboard's old inline
// MuscleSparkline so any card can drop in a trend without a full Recharts chart.
export default function Sparkline({
  values,
  color,
  filled = false,
  emphasis = false,
  width = 56,
  height = 24,
  className = '',
}: {
  values: number[]
  color: string
  filled?: boolean
  emphasis?: boolean
  width?: number
  height?: number
  className?: string
}) {
  if (values.length < 2) return <div style={{ width, height }} className={`flex-shrink-0 ${className}`} />
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const pad = 4
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - pad - ((v - min) / range) * (height - pad * 2),
  ])
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${d} L${width},${height} L0,${height} Z`
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} className={`flex-shrink-0 overflow-visible ${className}`}>
      {filled && <path d={area} fill={color} fillOpacity={0.12} />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={emphasis ? 2 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={emphasis ? 1 : 0.7}
      />
      <circle cx={last[0]} cy={last[1]} r={emphasis ? 2.5 : 1.5} fill={color} fillOpacity={emphasis ? 1 : 0.8} />
    </svg>
  )
}
