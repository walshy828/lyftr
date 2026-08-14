import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  children: ReactNode
  className?: string
}

/**
 * A single row of chips/tabs that never wraps. Touch/trackpad users swipe it
 * natively (plain overflow-x scroll — no custom gesture handling needed,
 * that would only fight the browser's own momentum scrolling). Mouse users
 * get paging chevrons at each edge, since a bare scroll container gives no
 * visual hint more content exists off-screen and no obvious way to reach it
 * without a trackpad.
 *
 * Chevrons and edge fades only render while there's somewhere to scroll TO —
 * both hide once fully scrolled to that edge, and neither renders at all if
 * the row doesn't overflow its container.
 */
export default function HScrollTabs({ children, className = '' }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    // Catches both container resizes (window resize) and content-width
    // changes (e.g. the equipment row growing once facets load async).
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [update, children])

  const page = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <div className={`relative ${className}`}>
      {canLeft && (
        <div className="pointer-events-none absolute -left-0.5 top-0 bottom-0 w-8 bg-gradient-to-r from-surface-base to-transparent z-10" />
      )}
      {canRight && (
        <div className="pointer-events-none absolute -right-0.5 top-0 bottom-0 w-8 bg-gradient-to-l from-surface-base to-transparent z-10" />
      )}

      <div
        ref={scrollRef}
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth"
      >
        {children}
      </div>

      {canLeft && (
        <button
          type="button"
          onClick={() => page(-1)}
          aria-label="Scroll left"
          className="hidden sm:flex absolute -left-3 top-1/2 -translate-y-1/2 z-20 w-7 h-7 items-center justify-center rounded-full bg-surface-elevated border border-surface-border shadow-md text-tx-secondary hover:text-tx-primary hover:bg-surface-muted transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      {canRight && (
        <button
          type="button"
          onClick={() => page(1)}
          aria-label="Scroll right"
          className="hidden sm:flex absolute -right-3 top-1/2 -translate-y-1/2 z-20 w-7 h-7 items-center justify-center rounded-full bg-surface-elevated border border-surface-border shadow-md text-tx-secondary hover:text-tx-primary hover:bg-surface-muted transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
