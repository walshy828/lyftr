// Port of web/src/hooks/useServerInfiniteList.ts — keep in sync.
// RN adaptation: no IntersectionObserver here, so the web's sentinelRef becomes an
// explicit loadMore() the screen wires to FlatList onEndReached. Offset lives in a
// ref (loadMore reads it directly) instead of state feeding an observer effect.
//
// One deliberate divergence from web: reload() is a *background* revalidate — it
// refetches page 0 and swaps the results in place WITHOUT clearing first, so a
// screen that refetches on focus (the stack keeps it mounted) doesn't flash its
// summary/cards to empty every time you navigate back. A deps change (e.g. search)
// still hard-clears, since stale results for the previous query shouldn't linger.
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
  // Background revalidate: refetch page 0 and swap in place (keeps current items
  // visible meanwhile). Call on focus / after a mutation without an empty flash.
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

  // Hard reset + fetch from scratch when deps change (e.g. the search query): clear
  // immediately so results for the previous query don't linger.
  useEffect(() => {
    setItems([])
    offsetRef.current = 0
    setHasMore(true)
    fetchingRef.current = false
    fetchPage(0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps])

  const loadMore = useCallback(() => {
    if (!hasMore || fetchingRef.current) return
    fetchPage(offsetRef.current, false)
  }, [hasMore, fetchPage])

  // Soft/background reload: fetchPage(0, replace) swaps the fresh page in on arrival
  // without a preceding setItems([]) — no empty flash. offset/hasMore are reset by
  // the fetch itself on success.
  const reload = useCallback(() => { fetchPage(0, true) }, [fetchPage])

  return { items, loadMore, hasMore, loading, initialLoading: loading && !initializedRef.current, reload }
}
