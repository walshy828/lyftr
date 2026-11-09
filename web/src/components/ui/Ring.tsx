import { useEffect, useState } from 'react'
import type React from 'react'

interface Props {
  /** 0..1+; values over 1 draw a full ring plus an overflow lap in `overColor`. */
  value: number
  color: string
  overColor?: string
  size?: number
  stroke?: number
  children?: React.ReactNode
  label?: string
}

/** Radial progress ring with centred content — the KPI primitive for Today. */
export default function Ring({ value, color, overColor = '#f43f5e', size = 72, stroke = 7, children, label }: Props) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  // Start empty and fill on mount, so the day's rings visibly "close" as the
  // screen opens (the transition below does the animating; reduced-motion
  // users get the final state immediately via the global rule in index.css).
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value))
    return () => cancelAnimationFrame(id)
  }, [value])
  const v = Math.max(0, shown)
  const main = Math.min(1, v)
  const over = v > 1 ? Math.min(1, v - 1) : 0
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-overlay)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - main)}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)' }}
        />
        {over > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={overColor} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - over)}
            style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0,0,0.2,1) 300ms' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}
