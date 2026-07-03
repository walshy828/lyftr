// Port of web/src/hooks/useServerInfiniteList.ts — keep in sync.
// RN adaptation: no IntersectionObserver here, so the web's sentinelRef becomes an
// explicit loadMore() the screen wires to FlatList onEndReached. Offset lives in a
// ref (loadMore reads it directly) instead of state feeding an observer effect.
import { useState, useEffect, useRef, useCallback } from 'react'

interface Options<T> {
  fetcher: (offset: number, limit: number) => Promise<T[]>
  pageSize?: number
  // Changing any dep resets the list and re-fetches from offset 0 (e.g. search query)
  deps?: readonly unknown[]
}

interface Result<T> {
  items: T[]
  // Wire to FlatList onEndReached — no-ops while a fetch is in flight or when done.
  loadMore: () => void
  hasMore: boolean
  loading: boolean
  // True only during the very first fetch — use for the initial spinner
  initialLoading: boolean
  // Call after create/delete to discard loaded items and re-fetch from scratch
  reload: () => void
}

export function useServerInfiniteList<T>({
  fetcher,
  pageSize = 20,
  deps = [],
}: Options<T>): Result<T> {
  const [items, setItems] = useState<T[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const offsetRef = useRef(0)
  // Tracks whether a fetch is in flight to prevent double-fetches (onEndReached can
  // fire repeatedly during momentum scrolling)
  const fetchingRef = useRef(false)
  // Incremented by reload() to force a reset even if deps haven't changed
  const [resetKey, setResetKey] = useState(0)
  // Flips true after first fetch settles — never resets — drives initialLoading
  const initializedRef = useRef(false)

  const fetchPage = useCallback(async (currentOffset: number, replace: boolean) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    try {
      const page = await fetcher(currentOffset, pageSize)
      setItems(prev => (replace ? page : [...prev, ...page]))
      offsetRef.current = currentOffset + page.length
      setHasMore(page.length === pageSize)
    } catch {
      // Web lets rejections escape (harmless in a browser); on RN an unhandled
      // rejection is red-box noise — keep what loaded and stop paginating instead.
      setHasMore(false)
    } finally {
      initializedRef.current = true
      fetchingRef.current = false
      setLoading(false)
    }
  }, [fetcher, pageSize])

  // Reset and fetch from scratch when deps or resetKey change
  useEffect(() => {
    setItems([])
    offsetRef.current = 0
    setHasMore(true)
    fetchingRef.current = false
    fetchPage(0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, resetKey])

  const loadMore = useCallback(() => {
    if (!hasMore || fetchingRef.current) return
    fetchPage(offsetRef.current, false)
  }, [hasMore, fetchPage])

  const reload = useCallback(() => setResetKey(k => k + 1), [])

  return { items, loadMore, hasMore, loading, initialLoading: loading && !initializedRef.current, reload }
}
