import { useEffect, useState } from 'react'
import api from '../services/api'

const PROTECTED_PREFIX = '/api/v1'

/**
 * Local meal-photo URLs (`/api/v1/food/photos/...`) are served behind
 * middleware.Auth() — a bare `<img src>` sends no bearer token (this app has
 * no cookies) and 401s silently. Fetch protected URLs through the authed
 * axios client instead and hand back an object URL for `<img src>`.
 * External URLs (e.g. OpenFoodFacts) pass through unchanged.
 */
export function useAuthedImage(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setSrc(null)
      return
    }
    if (!url.startsWith(PROTECTED_PREFIX)) {
      setSrc(url)
      return
    }

    let objectUrl: string | null = null
    let cancelled = false

    api.get(url.slice(PROTECTED_PREFIX.length), { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(res.data as Blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return src
}
