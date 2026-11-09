import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type React from 'react'

export interface MealMenuItem { label: string; icon: React.ElementType; onClick: () => void; hidden?: boolean }

/** The less-frequent per-meal actions, behind one button so the header stays clean on a phone. */
export default function MealMenu({ label, items }: { label: string; items: MealMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="w-10 h-10 rounded-xl flex items-center justify-center text-tx-muted hover:bg-surface-muted hover:text-tx-primary"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-56 py-1.5 rounded-xl bg-surface-overlay border border-surface-border shadow-dropdown animate-slide-up">
          {items.filter(i => !i.hidden).map(i => (
            <button
              key={i.label}
              role="menuitem"
              onClick={() => { setOpen(false); i.onClick() }}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-tx-secondary hover:text-tx-primary hover:bg-surface-muted/60"
            >
              <i.icon className="w-4 h-4 text-tx-muted" /> {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
