// Client-side JWT inspection, used only to decide *when* to refresh.
//
// This deliberately does not verify the signature — it can't, the secret lives
// on the server. Everything here is a scheduling hint: the backend remains the
// only authority on whether a token is actually valid, and a tampered `exp`
// buys an attacker nothing but a badly timed refresh call.

/** Seconds before real expiry at which a token is treated as already stale. */
export const REFRESH_SKEW_SECONDS = 300

/**
 * Reads the `exp` claim as a unix timestamp in seconds, or null if the token is
 * absent, malformed, or has no expiry. Callers treat null as "can't tell" and
 * fall back to the reactive 401 path rather than forcing a refresh.
 */
export const decodeJwtExp = (token: string | null | undefined): number | null => {
  if (!token) return null
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    // base64url -> base64, then pad: atob rejects the URL-safe alphabet and
    // unpadded input, and real-world JWT payloads are routinely both.
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
    const exp = JSON.parse(json)?.exp
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}

/** True when the token expires within `skew` seconds (or has already expired). */
export const isExpiringSoon = (token: string | null | undefined, skew = REFRESH_SKEW_SECONDS): boolean => {
  const exp = decodeJwtExp(token)
  if (exp === null) return false
  return exp - Date.now() / 1000 <= skew
}

/** True when the token is past its expiry outright — no skew, no grace. */
export const isExpired = (token: string | null | undefined): boolean => {
  const exp = decodeJwtExp(token)
  if (exp === null) return false
  return exp <= Date.now() / 1000
}
