import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useEscapeKey } from '../../hooks/useEscapeKey'

interface Props {
  isOpen: boolean
  onClose: () => void
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}

/**
 * Slide-up bottom sheet (dialog on wider screens). Shared scaffolding for the
 * app's various one-off sheets — backdrop, portal, scroll lock, Escape/click
 * dismissal, drag handle. Callers own everything below the header.
 */
export default function Sheet({ isOpen, onClose, title, icon, children }: Props) {
  useBodyScrollLock(isOpen)
  useEscapeKey(isOpen, onClose)

  if (!isOpen) return null

  const titleId = `sheet-title-${title.replace(/\s+/g, '-').toLowerCase()}`

  return createPortal((
    <div
      className="fixed inset-0 bg-black/60 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-surface-base border border-surface-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto w-10 h-1 rounded-full bg-surface-muted mt-3 mb-1 sm:hidden" />

        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            {icon && (
              <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                {icon}
              </div>
            )}
            <h2 id={titleId} className="font-display font-bold text-lg text-tx-primary">{title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-muted rounded-lg transition-colors">
            <X className="w-5 h-5 text-tx-muted" />
          </button>
        </div>

        {children}
      </div>
    </div>
  ), document.body)
}
