import type React from 'react'
import { useAuthedImage } from '../../hooks/useAuthedImage'

interface Props {
  src: string | null | undefined
  alt: string
  className?: string
  fallback: React.ReactNode
}

/**
 * Drop-in replacement for `<img>` where `src` may be a protected local
 * meal-photo URL (see useAuthedImage). Renders `fallback` until the image
 * resolves (or if it fails to load / there's no src at all).
 */
export default function AuthedImg({ src, alt, className, fallback }: Props) {
  const resolved = useAuthedImage(src)
  if (!resolved) return <>{fallback}</>
  return <img src={resolved} alt={alt} className={className} />
}
