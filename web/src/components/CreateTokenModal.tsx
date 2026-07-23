import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Check, KeyRound } from 'lucide-react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard'
import { tokenAPI, apiErrorMessage, type PersonalAccessToken } from '../services/api'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (token: PersonalAccessToken) => void
}

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: 'Never', days: null },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
]

// Two-step flow: a create form, then a one-time reveal of the plaintext
// token. Escape is disabled on the reveal step (only "Done" dismisses it) so
// an accidental keypress can't lose the only chance to copy the value.
export default function CreateTokenModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState<string | null>(null)
  const { copied, copy } = useCopyToClipboard()

  useBodyScrollLock(open)
  useEscapeKey(open && !value, onClose)

  if (!open) return null

  const reset = () => {
    setName('')
    setExpiresInDays(null)
    setError(null)
    setValue(null)
    setSaving(false)
  }
  const handleClose = () => {
    reset()
    onClose()
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const { token, value } = await tokenAPI.create(name.trim(), expiresInDays)
      setValue(value)
      onCreated(token)
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create token.'))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-surface-base border border-surface-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6">
        <div className="mx-auto w-10 h-1 rounded-full bg-surface-muted mb-4 sm:hidden" />
        {!value ? (
          <>
            <h3 className="font-display font-bold text-lg text-tx-primary mb-1">New personal access token</h3>
            <p className="text-sm text-tx-muted mb-5">
              Used by external clients, like the MCP server, to access your data.
            </p>
            {error && (
              <div className="alert-error mb-4">
                <span>{error}</span>
              </div>
            )}
            <label className="block mb-4">
              <span className="text-xs font-medium text-tx-muted mb-1 block">Name</span>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Claude MCP server"
                className="input"
              />
            </label>
            <div className="mb-6">
              <span className="text-xs font-medium text-tx-muted mb-1 block">Expires</span>
              <div className="flex gap-2 flex-wrap">
                {EXPIRY_OPTIONS.map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setExpiresInDays(opt.days)}
                    className={expiresInDays === opt.days ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleClose} className="flex-1 py-3 bg-surface-muted hover:bg-surface-muted/80 text-tx-secondary rounded-xl transition-colors font-medium text-sm">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || saving}
                className="flex-1 py-3 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-xl transition-colors font-semibold text-sm"
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="font-display font-bold text-lg text-tx-primary mb-1 flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> Token created
            </h3>
            <p className="text-sm text-tx-muted mb-4">
              Copy this now — <strong className="text-tx-primary">you won't be able to see it again</strong>.
            </p>
            <div className="flex items-center gap-2 mb-6">
              <code className="flex-1 min-w-0 truncate bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-xs font-mono text-tx-primary">
                {value}
              </code>
              <button
                onClick={() => copy(value)}
                aria-label="Copy token"
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-surface-muted border border-surface-border text-tx-muted hover:text-tx-primary hover:bg-surface-overlay transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-success-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={handleClose} className="w-full py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-xl transition-colors font-semibold text-sm">
              Done
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
