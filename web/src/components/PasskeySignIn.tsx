import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Fingerprint, Loader } from 'lucide-react'
import { passkeyAPI, apiErrorMessage } from '../services/api'
import { useAuthStore } from '../stores/auth'
import { useServerInfo } from '../hooks/useServerInfo'
import {
  decodeRequestOptions, encodeAssertion, isWebAuthnSupported, webauthnErrorMessage,
} from '../utils/webauthn'

/**
 * "Sign in with a passkey" — usernameless, so the browser offers whichever
 * passkey matches and no email is typed.
 *
 * Renders nothing unless the server has a Relying Party configured *and* the
 * browser supports WebAuthn. Both checks matter: a button that can only fail is
 * worse than no button, and a self-hosted instance reached by bare IP can never
 * support passkeys at all.
 */
export default function PasskeySignIn({ onError }: { onError: (message: string) => void }) {
  const navigate = useNavigate()
  const adoptSession = useAuthStore(s => s.adoptSession)
  const serverInfo = useServerInfo()
  const [busy, setBusy] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => { setSupported(isWebAuthnSupported()) }, [])

  if (!supported || !serverInfo?.passkeys_enabled) return null

  const signIn = async () => {
    setBusy(true)
    try {
      const { publicKey, challenge_id } = await passkeyAPI.loginBegin()

      const credential = await navigator.credentials.get({
        publicKey: decodeRequestOptions(publicKey),
      }) as PublicKeyCredential | null

      // Null rather than a throw happens on some browsers when the user
      // dismisses the sheet. Treated as a cancel, not a failure.
      if (!credential) return

      const session = await passkeyAPI.loginFinish(challenge_id, encodeAssertion(credential))
      adoptSession(session)
      navigate('/')
    } catch (err: any) {
      // A ceremony the user cancelled reports null and stays silent; anything
      // from the server keeps its own message.
      const message = err?.response
        ? apiErrorMessage(err, "That passkey didn't work.")
        : webauthnErrorMessage(err)
      if (message) onError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-surface-border" />
        <span className="text-xs text-tx-muted">or</span>
        <div className="flex-1 h-px bg-surface-border" />
      </div>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="btn-secondary btn-lg w-full flex items-center justify-center gap-2"
      >
        {busy
          ? <Loader className="w-4 h-4 animate-spin" />
          : <><Fingerprint className="w-4 h-4" /> Sign in with a passkey</>}
      </button>
    </>
  )
}
