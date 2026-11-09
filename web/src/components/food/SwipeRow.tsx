import { useRef, useState } from 'react'
import type React from 'react'

interface Action {
  label: string
  icon: React.ElementType
  className: string
  onTrigger: () => void
}

interface Props {
  /** Revealed by swiping right (content moves right). */
  left?: Action
  /** Revealed by swiping left (content moves left). */
  right?: Action
  children: React.ReactNode
}

const TRIGGER = 88  // px of travel that commits the action on release
const MAX = 120

/**
 * Touch swipe-to-act for list rows, the phone-native way to delete or save an
 * item without a row full of tiny icon buttons. Horizontal intent is decided
 * on the first few px so vertical scrolling still works; mouse users get the
 * row's own buttons instead (pointerType check).
 */
export default function SwipeRow({ left, right, children }: Props) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    start.current = { x: e.clientX, y: e.clientY, axis: null }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const mx = e.clientX - s.x
    const my = e.clientY - s.y
    if (!s.axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
      s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
    }
    if (s.axis !== 'x') return
    let next = Math.max(-MAX, Math.min(MAX, mx))
    if (next > 0 && !left) next = 0
    if (next < 0 && !right) next = 0
    setDx(next)
  }
  const end = () => {
    if (dx >= TRIGGER) left?.onTrigger()
    else if (dx <= -TRIGGER) right?.onTrigger()
    start.current = null
    setDx(0)
  }

  const shown = dx > 0 ? left : dx < 0 ? right : null
  const armed = Math.abs(dx) >= TRIGGER

  return (
    <div className="relative overflow-hidden">
      {shown && (
        <div className={`absolute inset-0 flex items-center px-5 ${dx > 0 ? 'justify-start' : 'justify-end'} ${shown.className}`} aria-hidden>
          <span className={`flex items-center gap-2 text-sm font-semibold text-white transition-transform ${armed ? 'scale-110' : 'scale-100'}`}>
            <shown.icon className="w-5 h-5" /> {shown.label}
          </span>
        </div>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? 'none' : 'transform 200ms ease-out', touchAction: 'pan-y' }}
        className="relative bg-surface-raised"
      >
        {children}
      </div>
    </div>
  )
}
