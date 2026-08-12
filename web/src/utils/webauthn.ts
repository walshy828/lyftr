// WebAuthn plumbing.
//
// The browser API speaks ArrayBuffers; the server speaks base64url JSON. This
// module is that translation and nothing more — no policy, no UI decisions.

export const bufferToBase64url = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const base64urlToBuffer = (value: string): ArrayBuffer => {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Whether this browser can do WebAuthn at all. Checked before offering any
 * passkey affordance — a button that throws on click is worse than no button.
 */
export const isWebAuthnSupported = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential !== 'undefined' &&
  typeof navigator.credentials?.create === 'function'

/**
 * Whether the device has a built-in authenticator (Face ID, Touch ID, Windows
 * Hello). Used to word the prompt honestly: on a laptop with no biometrics the
 * passkey may live on a phone or a security key instead.
 */
export const hasPlatformAuthenticator = async (): Promise<boolean> => {
  if (!isWebAuthnSupported()) return false
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/** The server's creation options, decoded into what navigator.credentials wants. */
export const decodeCreationOptions = (options: any): PublicKeyCredentialCreationOptions => ({
  ...options,
  challenge: base64urlToBuffer(options.challenge),
  user: { ...options.user, id: base64urlToBuffer(options.user.id) },
  excludeCredentials: (options.excludeCredentials ?? []).map((c: any) => ({
    ...c,
    id: base64urlToBuffer(c.id),
  })),
})

export const decodeRequestOptions = (options: any): PublicKeyCredentialRequestOptions => ({
  ...options,
  challenge: base64urlToBuffer(options.challenge),
  allowCredentials: (options.allowCredentials ?? []).map((c: any) => ({
    ...c,
    id: base64urlToBuffer(c.id),
  })),
})

/** Re-encodes a registration result into the JSON shape the server verifies. */
export const encodeAttestation = (cred: PublicKeyCredential) => {
  const response = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
    },
  }
}

/** Re-encodes an authentication result into the JSON shape the server verifies. */
export const encodeAssertion = (cred: PublicKeyCredential) => {
  const response = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      // Null for a non-discoverable credential; the server needs it to know
      // which account a usernameless sign-in belongs to.
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  }
}

/**
 * Turns a failed ceremony into something worth showing a user.
 *
 * NotAllowedError covers both "cancelled" and "timed out" and is by far the
 * most common outcome — it is not an error worth alarming anyone about, so it
 * returns null and the caller stays quiet.
 */
export const webauthnErrorMessage = (err: unknown): string | null => {
  const name = (err as { name?: string })?.name
  switch (name) {
    case 'NotAllowedError':
      return null
    case 'InvalidStateError':
      return 'This device already has a passkey for your account.'
    case 'SecurityError':
      // Almost always the RP ID not matching the page's origin.
      return "This server's passkey settings don't match the address you're using. Check WEBAUTHN_RP_ID."
    case 'NotSupportedError':
      return "This device can't create a passkey."
    default:
      return 'Something went wrong with that passkey. Please try again.'
  }
}
