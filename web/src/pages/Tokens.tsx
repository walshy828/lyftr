import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, KeyRound, Plus, Trash2, Loader, AlertCircle } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'
import CreateTokenModal from '../components/CreateTokenModal'
import { tokenAPI, apiErrorMessage, type PersonalAccessToken } from '../services/api'

function formatDate(iso: string | null) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Tokens() {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<PersonalAccessToken | null>(null)
  const [revoking, setRevoking] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setTokens(await tokenAPI.list())
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load tokens.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await tokenAPI.revoke(revokeTarget.id)
      setTokens(prev => prev.filter(t => t.id !== revokeTarget.id))
      setRevokeTarget(null)
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to revoke token.'))
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <Link to="/settings" className="flex items-center gap-2 text-sm text-tx-muted hover:text-tx-primary transition-colors">
        <ArrowLeft className="w-4 h-4" /> Settings
      </Link>

      <PageHeader
        title="Personal access tokens"
        subtitle="Long-lived tokens for external clients, like the MCP server, to read and write your data."
        action={
          <button onClick={() => setCreating(true)} className="btn-primary btn-md">
            <Plus className="w-4 h-4" /> New token
          </button>
        }
      />

      {error && (
        <div className="alert-error">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-tx-muted">
          <Loader className="w-5 h-5 animate-spin" />
        </div>
      ) : tokens.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No tokens yet"
          subtitle="Create one to connect an MCP client or script."
          action={
            <button onClick={() => setCreating(true)} className="btn-primary btn-sm">
              <Plus className="w-3.5 h-3.5" /> New token
            </button>
          }
        />
      ) : (
        <div className="card divide-y divide-surface-border overflow-hidden">
          {tokens.map(token => (
            <div key={token.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-tx-primary truncate">{token.name}</p>
                <p className="text-xs text-tx-muted font-mono mt-0.5 truncate">{token.token_prefix}…</p>
                <p className="text-xs text-tx-muted mt-1">
                  Created {formatDate(token.created_at)} · Last used {formatDate(token.last_used_at)} · Expires {formatDate(token.expires_at)}
                </p>
              </div>
              <button
                onClick={() => setRevokeTarget(token)}
                aria-label={`Revoke ${token.name}`}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-tx-muted hover:bg-error-500/10 hover:text-error-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <CreateTokenModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={token => setTokens(prev => [token, ...prev])}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke token?"
        body={`Any client using "${revokeTarget?.name}" will immediately lose access. This can't be undone.`}
        confirmLabel={revoking ? 'Revoking…' : 'Revoke'}
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  )
}
