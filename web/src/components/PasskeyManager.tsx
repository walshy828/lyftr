import { useCallback, useEffect, useState } from 'react'
import { Fingerprint, Loader, Plus } from 'lucide-react'
import { passkeyAPI, apiErrorMessage, type Passkey } from '../services/api'
import { useServerInfo } from '../hooks/useServerInfo'
import {
  decodeCreationOptions, encodeAttestation, hasPlatformAuthenticator,
  isWebAuthnSupported, webauthnErrorMessage,
} from '../utils/webauthn'

const used = (iso: string | null) => {
  if (!iso) return 'never used'
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000
  if (days < 1) return 'used today'
  if (days < 2) return 'used yesterday'
  return `used ${Math.round(days)} days ago`
}

/**
 * Enrol and manage passkeys.
 *
 * Renders an explanation instead of controls when the server has no Relying
 * Party configured — self-hosters hit this, and "nothing is here" is a much
 * worse answer than "here's the env var you're missing".
 */
export default function PasskeyManager() {
  const serverInfo = useServerInfo()
  const [keys, setKeys] = useState<Passkey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [platform, setPlatform] = useState(false)

  const supported = isWebAuthnSupported()
  const enabled = !!serverInfo?.passkeys_enabled

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      setKeys(await passkeyAPI.list())
    } catch (err: any) {
      setError(apiErrorMessage(err, "Couldn't load your passkeys."))
      setKeys([])
    }
  }, [enabled])

  useEffect(() => { load() }, [load])
  useEffect(() => { hasPlatformAuthenticator().then(setPlatform) }, [])

  if (!enabled) {
    return (
      <p className="text-sm text-tx-muted py-4">
        Passkeys aren't enabled on this server. Set <code className="font-mono text-xs">WEBAUTHN_RP_ID</code> to
        the hostname you reach Lyftr at (it must be a real hostname over HTTPS —
        a bare IP address can't be used) and restart the backend.
      </p>
    )
  }

  if (!supported) {
    return <p className="text-sm text-tx-muted py-4">This browser doesn't support passkeys.</p>
  }

  const enrol = async () => {
    setEnrolling(true)
    setError(null)
    try {
      const { publicKey } = await passkeyAPI.registerBegin()

      const credential = await navigator.credentials.create({
        publicKey: decodeCreationOptions(publicKey),
      }) as PublicKeyCredential | null
      if (!credential) return

      // Name left empty on purpose — the server labels it from the User-Agent,
      // which beats making someone name a credential before they've used it.
      await passkeyAPI.registerFinish('', encodeAttestation(credential))
      await load()
    } catch (err: any) {
      const message = err?.response
        ? apiErrorMessage(err, "Couldn't add that passkey.")
        : webauthnErrorMessage(err)
      if (message) setError(message)
    } finally {
      setEnrolling(false)
    }
  }

  const remove = async (id: number) => {
    setDeleting(id)
    try {
      await passkeyAPI.delete(id)
      setKeys(prev => (prev ?? []).filter(k => k.id !== id))
    } catch (err: any) {
      setError(apiErrorMessage(err, "Couldn't remove that passkey."))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="py-4 space-y-3">
      <p className="text-xs text-tx-muted">
        {platform
          ? 'Sign in with Face ID, Touch ID, or your device passcode instead of a password.'
          : 'Sign in with a passkey from your phone or a security key instead of a password.'}
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {keys === null && (
        <p className="text-sm text-tx-muted flex items-center gap-2">
          <Loader className="w-4 h-4 animate-spin" /> Loading…
        </p>
      )}

      {keys?.map(key => (
        <div key={key.id} className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Fingerprint className="w-4 h-4 mt-0.5 flex-shrink-0 text-tx-muted" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-tx-primary truncate">{key.name}</p>
              <p className="text-xs text-tx-muted">
                Added {new Date(key.created_at).toLocaleDateString()} · {used(key.last_used_at)}
              </p>
            </div>
          </div>
          <button
            onClick={() => remove(key.id)}
            disabled={deleting === key.id}
            className="btn-secondary btn-sm flex-shrink-0"
          >
            {deleting === key.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Remove'}
          </button>
        </div>
      ))}

      {keys?.length === 0 && <p className="text-sm text-tx-muted">No passkeys yet.</p>}

      <button onClick={enrol} disabled={enrolling} className="btn-primary btn-sm">
        {enrolling
          ? <Loader className="w-3.5 h-3.5 animate-spin" />
          : <><Plus className="w-3.5 h-3.5" /> Add a passkey</>}
      </button>

      {!!keys?.length && (
        // Passkeys are additive here, not a replacement: removing the password
        // as a factor is a bigger decision than this screen should make quietly.
        <p className="text-xs text-tx-muted pt-1">
          Your password still works. Removing every passkey just means signing in
          with it again.
        </p>
      )}
    </div>
  )
}
