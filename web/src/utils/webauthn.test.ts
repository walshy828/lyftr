import { describe, it, expect } from 'vitest'
import {
  base64urlToBuffer, bufferToBase64url, decodeCreationOptions, decodeRequestOptions,
  webauthnErrorMessage,
} from './webauthn'

const bytes = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf))

describe('base64url round-trip', () => {
  it('survives bytes that produce the URL-unsafe alphabet', () => {
    // 0xfb/0xff are exactly the bytes that encode to '+' and '/' in standard
    // base64 — the ones that break a naive atob/btoa pair.
    const original = new Uint8Array([0, 1, 250, 251, 254, 255, 127, 128]).buffer
    const encoded = bufferToBase64url(original)

    expect(encoded).not.toMatch(/[+/=]/)
    expect(bytes(base64urlToBuffer(encoded))).toEqual(bytes(original))
  })

  it('handles every length modulo 4, where padding differs', () => {
    for (let len = 0; len < 9; len++) {
      const original = new Uint8Array(Array.from({ length: len }, (_, i) => i * 31 % 256)).buffer
      expect(bytes(base64urlToBuffer(bufferToBase64url(original)))).toEqual(bytes(original))
    }
  })

  it('decodes unpadded input, which is what the server sends', () => {
    expect(bytes(base64urlToBuffer('AQID'))).toEqual([1, 2, 3])
    expect(bytes(base64urlToBuffer('AQI'))).toEqual([1, 2])
  })
})

describe('decodeCreationOptions', () => {
  const options = {
    challenge: 'AQID',
    rp: { id: 'lyftr.example.com', name: 'Lyftr' },
    user: { id: 'BAUG', name: 'a@b.c', displayName: 'A' },
    excludeCredentials: [{ type: 'public-key', id: 'BwgJ' }],
  }

  it('converts every base64url field the browser needs as a buffer', () => {
    const decoded = decodeCreationOptions(options)
    expect(bytes(decoded.challenge as ArrayBuffer)).toEqual([1, 2, 3])
    expect(bytes(decoded.user.id as ArrayBuffer)).toEqual([4, 5, 6])
    expect(bytes(decoded.excludeCredentials![0].id as ArrayBuffer)).toEqual([7, 8, 9])
  })

  it('preserves the fields it does not touch', () => {
    const decoded = decodeCreationOptions(options)
    expect(decoded.rp).toEqual({ id: 'lyftr.example.com', name: 'Lyftr' })
    expect(decoded.user.name).toBe('a@b.c')
  })

  it('tolerates a missing excludeCredentials (first enrolment)', () => {
    const decoded = decodeCreationOptions({ ...options, excludeCredentials: undefined })
    expect(decoded.excludeCredentials).toEqual([])
  })
})

describe('decodeRequestOptions', () => {
  it('decodes the challenge and tolerates no allowCredentials', () => {
    // A discoverable login sends no allowCredentials at all — that's the point.
    const decoded = decodeRequestOptions({ challenge: 'AQID' })
    expect(bytes(decoded.challenge as ArrayBuffer)).toEqual([1, 2, 3])
    expect(decoded.allowCredentials).toEqual([])
  })
})

describe('webauthnErrorMessage', () => {
  it('stays silent when the user cancels', () => {
    // NotAllowedError is both "cancelled" and "timed out", and is the most
    // common outcome by far — alarming the user over it would be wrong.
    expect(webauthnErrorMessage({ name: 'NotAllowedError' })).toBeNull()
  })

  it('explains an RP ID mismatch, the main self-hosting trap', () => {
    expect(webauthnErrorMessage({ name: 'SecurityError' })).toMatch(/WEBAUTHN_RP_ID/)
  })

  it('explains a device that already has a passkey', () => {
    expect(webauthnErrorMessage({ name: 'InvalidStateError' })).toMatch(/already has a passkey/)
  })

  it('falls back to something generic but non-empty', () => {
    expect(webauthnErrorMessage({ name: 'WeirdError' })).toBeTruthy()
    expect(webauthnErrorMessage(undefined)).toBeTruthy()
  })
})
