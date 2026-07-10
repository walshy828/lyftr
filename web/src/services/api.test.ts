import { describe, it, expect, vi } from 'vitest'
import { apiUrl, apiErrorMessage } from './api'

describe('apiUrl', () => {
  it('builds the same-origin path when no origin is given', () => {
    expect(apiUrl()).toBe('/api/v1')
  })

  it('prefixes an absolute origin', () => {
    expect(apiUrl('http://localhost:3000')).toBe('http://localhost:3000/api/v1')
  })
})

describe('apiErrorMessage', () => {
  it('passes through a structured server error', () => {
    const msg = apiErrorMessage(
      { response: { status: 401, data: { error: 'Invalid email or password' } } },
      'fallback',
    )
    expect(msg).toBe('Invalid email or password')
  })

  it('flags 404/405 as a misconfigured server URL', () => {
    expect(apiErrorMessage({ response: { status: 404, data: {} } }, 'fallback')).toMatch(/misconfigured/i)
    expect(apiErrorMessage({ response: { status: 405, data: {} } }, 'fallback')).toMatch(/misconfigured/i)
  })

  it('maps 5xx to a server error', () => {
    expect(apiErrorMessage({ response: { status: 503, data: {} } }, 'fallback')).toMatch(/server error/i)
  })

  it('uses the fallback for other responses without a server error', () => {
    expect(apiErrorMessage({ response: { status: 400, data: {} } }, 'fallback')).toBe('fallback')
  })

  it('reports a connectivity problem when there is no response', () => {
    expect(apiErrorMessage({ request: {} }, 'fallback')).toMatch(/can't reach the server/i)
    expect(apiErrorMessage(new Error('Network Error'), 'fallback')).toMatch(/can't reach the server/i)
  })
})

describe('refreshAccessToken', () => {
  it('shares one in-flight refresh across concurrent 401s', async () => {
    const { default: axios } = await import('axios')
    const { refreshAccessToken } = await import('./api')
    localStorage.setItem('refresh_token', 'old-refresh')
    const post = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { token: 'new-access', refresh_token: 'new-refresh' } },
    })

    const [a, b, c] = await Promise.all([
      refreshAccessToken(), refreshAccessToken(), refreshAccessToken(),
    ])

    expect(post).toHaveBeenCalledTimes(1)
    expect(a).toBe('new-access')
    expect(b).toBe('new-access')
    expect(c).toBe('new-access')
    expect(localStorage.getItem('access_token')).toBe('new-access')
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh')

    // Once settled, the next expiry starts a fresh refresh.
    await refreshAccessToken()
    expect(post).toHaveBeenCalledTimes(2)

    post.mockRestore()
    localStorage.clear()
  })
})
