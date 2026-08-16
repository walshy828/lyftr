import { useCallback, useState } from 'react'

const COMPANION_SYNC_SCHEME = 'lyftr://sync'

/**
 * Triggers a same-device sync in the Android companion app via lyftr://sync
 * (see android/phone/.../sync/SyncTriggerActivity.kt) instead of waiting on
 * its periodic background job — lets "Refresh" get fresh cardio data exactly
 * when the user is looking at this panel.
 *
 * There's no way for JS to directly ask Android whether a scheme has a
 * registered handler, so "app not installed" is inferred from whether the
 * tab actually gets backgrounded within a short window after navigating —
 * if the OS never hands off to another app, nothing was listening.
 *
 * The companion app's sync is async (Health Connect read + backend POST
 * happen after SyncTriggerActivity already returned control to the
 * browser), so on return this polls `reload` a few times rather than once.
 */
export function useCompanionSync(reload: () => void) {
  const [status, setStatus] = useState<'idle' | 'triggering' | 'unavailable'>('idle')

  const trigger = useCallback(() => {
    setStatus('triggering')
    let handled = false

    const onHidden = () => {
      if (document.hidden) handled = true
    }
    document.addEventListener('visibilitychange', onHidden)

    const unavailableTimeout = setTimeout(() => {
      document.removeEventListener('visibilitychange', onHidden)
      if (!handled) setStatus('unavailable')
    }, 1500)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(unavailableTimeout)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('focus', onVisible)
      setTimeout(reload, 1500)
      setTimeout(reload, 4000)
      setTimeout(() => {
        reload()
        setStatus('idle')
      }, 8000)
    }
    window.addEventListener('focus', onVisible)

    const returnTo = encodeURIComponent(window.location.href)
    window.location.href = `${COMPANION_SYNC_SCHEME}?returnTo=${returnTo}`
  }, [reload])

  return { trigger, status }
}
