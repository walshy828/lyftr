import type React from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: React.ReactNode
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Generic confirm/cancel bottom sheet shared by any destructive-or-notable
// action (discard workout, revoke token, ...). Renders to document.body so it
// overlays full-screen contexts like gym mode; Escape dismisses to the
// non-destructive choice (onCancel).
export default function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel = 'Cancel', destructive = true, onConfirm, onCancel,
}: Props) {
  useBodyScrollLock(open)
  useEscapeKey(open, onCancel)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-surface-base border border-surface-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-6">
        <div className="mx-auto w-10 h-1 rounded-full bg-surface-muted mb-4 sm:hidden" />
        <h3 className="font-display font-bold text-lg text-tx-primary mb-1">{title}</h3>
        <p className="text-sm text-tx-muted mb-5">{body}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 bg-surface-muted hover:bg-surface-muted/80 text-tx-secondary rounded-xl transition-colors font-medium text-sm">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 rounded-xl transition-colors font-semibold text-sm flex items-center justify-center gap-1.5 ${
              destructive ? 'bg-error-500 hover:bg-error-600 text-white' : 'bg-brand-500 hover:bg-brand-600 text-white'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
