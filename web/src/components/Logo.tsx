import LogoMark from './LogoMark'

const sizeMap = {
  sm: { mark: 24, fontSize: 17 },
  md: { mark: 28, fontSize: 19 },
  lg: { mark: 40, fontSize: 26 },
}

export default function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = sizeMap[size]
  return (
    <div className="flex items-center gap-2">
      <LogoMark size={s.mark} />
      <span className="font-display font-extrabold text-tx-primary" style={{ fontSize: s.fontSize, letterSpacing: '-0.04em' }}>
        lyftr
      </span>
    </div>
  )
}
