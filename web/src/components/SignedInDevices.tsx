import { useCallback, useEffect, useState } from 'react'
import { Loader, Monitor, Check } from 'lucide-react'
import { sessionAPI, apiErrorMessage, type DeviceSession } from '../services/api'
import { useAuthStore } from '../stores/auth'

const relative = (iso: string): string => {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 90) return 'just now'
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)} min ago`
  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const expiryLabel = (iso: string): string => {
  const days = (new Date(iso).getTime() - Date.now()) / 86_400_000
  if (days < 1) return 'expires today'
  if (days < 2) return 'expires tomorrow'
  return `expires in ${Math.round(days)} days`
}

/**
 * The list of devices holding a live session, with a per-device sign-out.
 *
 * Lives on its own rather than inside Settings.tsx because it owns real
 * asynchronous state (fetch, per-row revoke, error) that has nothing to do with
 * the rest of that page.
 */
export default function SignedInDevices() {
  const logout = useAuthStore(s => s.logout)
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSessions(await sessionAPI.list())
      setError(null)
    } catch (err: any) {
      setError(apiErrorMessage(err, "Couldn't load your signed-in devices."))
      setSessions([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const revoke = async (session: DeviceSession) => {
    // Signing out the current device is a legitimate thing to want (you're
    // handing the phone over), but it ends the session you're using, so it goes
    // through the normal logout path instead of leaving a dead shell running.
    if (session.current) {
      logout()
      return
    }
    setRevoking(session.id)
    try {
      await sessionAPI.revoke(session.id)
      setSessions(prev => (prev ?? []).filter(s => s.id !== session.id))
    } catch (err: any) {
      setError(apiErrorMessage(err, "Couldn't sign that device out."))
    } finally {
      setRevoking(null)
    }
  }

  if (sessions === null) {
    return (
      <div className="py-4 flex items-center gap-2 text-sm text-tx-muted">
        <Loader className="w-4 h-4 animate-spin" /> Loading devices…
      </div>
    )
  }

  return (
    <div className="py-4 space-y-3">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {sessions.length === 0 && !error && (
        <p className="text-sm text-tx-muted">No other devices are signed in.</p>
      )}

      {sessions.map(session => (
        <div key={session.id} className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Monitor className="w-4 h-4 mt-0.5 flex-shrink-0 text-tx-muted" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-tx-primary truncate">
                {session.label}
                {session.current && (
                  <span className="ml-2 text-xs font-normal text-brand-400">
                    <Check className="w-3 h-3 inline -mt-0.5" /> this device
                  </span>
                )}
              </p>
              <p className="text-xs text-tx-muted">
                Last used {relative(session.last_seen_at)}
                {session.remembered ? ` · ${expiryLabel(session.expires_at)}` : ' · short session'}
              </p>
            </div>
          </div>
          <button
            onClick={() => revoke(session)}
            disabled={revoking === session.id}
            className="btn-secondary btn-sm flex-shrink-0"
          >
            {revoking === session.id
              ? <Loader className="w-3.5 h-3.5 animate-spin" />
              : session.current ? 'Sign out' : 'Remove'}
          </button>
        </div>
      ))}

      {sessions.length > 0 && (
        // Set expectations honestly: the liveness check runs when a device
        // renews its token, not on every request, so a removed device can keep
        // working briefly on the access token it already holds.
        <p className="text-xs text-tx-muted pt-1">
          A removed device loses access within the hour. To cut every device off
          immediately, change your password.
        </p>
      )}
    </div>
  )
}
