import { useId } from 'react'

/**
 * Lyftr mark: a rounded tile in the signal gradient carrying a rising trace —
 * a barbell's plates reading as the first and last points of an upward trend.
 * Says "lifting" and "trending the right way" in one glyph.
 */
export default function LogoMark({ size = 28 }: { size?: number }) {
  // Unique per instance: the desktop rail's copy is display:none on phones, and
  // Chrome won't resolve a gradient whose <defs> live in a hidden subtree.
  const gid = `lyftr-mark-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="flex-shrink-0">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#13c2ec" />
          <stop offset="1" stopColor="#4fe3a1" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gid})`} />
      <path d="M7 21.5 L12.5 16 L17 19 L25 10.5" fill="none" stroke="#0a0b0f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4.6" y="18" width="4.8" height="7" rx="1.6" fill="#0a0b0f" />
      <rect x="22.6" y="7" width="4.8" height="7" rx="1.6" fill="#0a0b0f" />
    </svg>
  )
}
