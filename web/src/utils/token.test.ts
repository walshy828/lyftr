import { describe, it, expect } from 'vitest'
import { decodeJwtExp, isExpiringSoon, isExpired, REFRESH_SKEW_SECONDS } from './token'

// Builds a token whose payload decodes but whose signature is meaningless —
// which is all the client ever looks at.
const tokenWithExp = (exp: number | undefined, extra: Record<string, unknown> = {}) => {
  const b64url = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256' })}.${b64url({ ...extra, ...(exp === undefined ? {} : { exp }) })}.sig`
}

const now = () => Math.floor(Date.now() / 1000)

describe('decodeJwtExp', () => {
  it('reads the exp claim', () => {
    expect(decodeJwtExp(tokenWithExp(1893456000))).toBe(1893456000)
  })

  it('decodes payloads that need base64url translation and padding', () => {
    // A payload long enough to require padding, containing bytes that produce
    // '-' and '_' in the URL-safe alphabet — atob rejects both untranslated.
    const token = tokenWithExp(1893456000, { email: 'a+b/c@example.com', sub: 'ÿÿÿ' })
    expect(decodeJwtExp(token)).toBe(1893456000)
  })

  it('returns null rather than throwing on unusable input', () => {
    expect(decodeJwtExp(null)).toBeNull()
    expect(decodeJwtExp(undefined)).toBeNull()
    expect(decodeJwtExp('')).toBeNull()
    expect(decodeJwtExp('not-a-jwt')).toBeNull()
    expect(decodeJwtExp('a.!!!not-base64!!!.c')).toBeNull()
    expect(decodeJwtExp(tokenWithExp(undefined))).toBeNull()
  })

  it('ignores a non-numeric exp', () => {
    const token = `${btoa('{}')}.${btoa(JSON.stringify({ exp: 'soon' }))}.sig`
    expect(decodeJwtExp(token)).toBeNull()
  })
})

describe('isExpiringSoon', () => {
  it('is false for a token with plenty of life left', () => {
    expect(isExpiringSoon(tokenWithExp(now() + 3600))).toBe(false)
  })

  it('is true once the token is inside the refresh skew', () => {
    expect(isExpiringSoon(tokenWithExp(now() + REFRESH_SKEW_SECONDS - 10))).toBe(true)
  })

  it('is true for an already-expired token', () => {
    expect(isExpiringSoon(tokenWithExp(now() - 10))).toBe(true)
  })

  it('honours a custom skew', () => {
    const token = tokenWithExp(now() + 600)
    expect(isExpiringSoon(token, 60)).toBe(false)
    expect(isExpiringSoon(token, 900)).toBe(true)
  })

  // "Can't tell" must not force a refresh — the reactive 401 path handles it.
  it('is false when the expiry cannot be read', () => {
    expect(isExpiringSoon(null)).toBe(false)
    expect(isExpiringSoon('garbage')).toBe(false)
  })
})

describe('isExpired', () => {
  it('applies no grace period', () => {
    expect(isExpired(tokenWithExp(now() + 30))).toBe(false)
    expect(isExpired(tokenWithExp(now() - 1))).toBe(true)
  })

  it('is false when the expiry cannot be read', () => {
    expect(isExpired(null)).toBe(false)
    expect(isExpired('garbage')).toBe(false)
  })
})
