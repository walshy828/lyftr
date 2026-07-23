import { useState, useCallback, useRef } from 'react'

/**
 * Copies text to the clipboard and exposes a transient `copied` flag (resets
 * after 2s) so a button can show "Copied!" feedback.
 */
export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCopied(false), 2000)
  }, [])

  return { copied, copy }
}
