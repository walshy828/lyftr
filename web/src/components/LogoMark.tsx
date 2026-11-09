import { useId } from 'react'

/**
 * Baseline mark: a shield (private, self-hosted) carrying a vitals trace. The flat
 * runs on either side of the spike are the baseline; the spike is the signal.
 */
export default function LogoMark({ size = 28 }: { size?: number }) {
  // Unique per instance: the desktop rail's copy is display:none on phones, and
  // Chrome won't resolve a gradient whose <defs> live in a hidden subtree.
  const gid = `baseline-mark-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="flex-shrink-0">
      <defs>
        <linearGradient id={gid} x1="5" y1="3" x2="27" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#13c2ec" />
          <stop offset="1" stopColor="#4fe3a1" />
        </linearGradient>
      </defs>
      <path d="M16 3 L27 6.8 V15 C27 21.5 22.5 26 16 29 C9.5 26 5 21.5 5 15 V6.8 Z" fill={`url(#${gid})`} />
      <path d="M9 15.5 H13 L15 11 L17.5 20 L19.5 15.5 H23" fill="none" stroke="#0a0b0f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
