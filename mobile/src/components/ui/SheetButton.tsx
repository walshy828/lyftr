import { Pressable } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { useTheme } from '../../theme/useTheme'
import { AppText } from './Typography'

type Variant = 'muted' | 'primary' | 'destructive'

interface Props {
  label: string
  onPress: () => void
  variant?: Variant
  /** Optional leading icon (e.g. the action's glyph). */
  icon?: LucideIcon
  disabled?: boolean
}

// The chunky button used inside sheets (Cancel / confirm rows, and each ActionSheet
// option). 52pt tall, rounded-2xl, fills its parent's width — wrap in a flex-1 View
// to share a row, or drop straight into a column for a full-width stack.
const FILL: Record<Variant, string> = {
  muted: 'bg-surface-muted active:opacity-70',
  primary: 'bg-brand-500 active:opacity-80',
  destructive: 'bg-error-500 active:opacity-80',
}

export function SheetButton({ label, onPress, variant = 'muted', icon: Icon, disabled = false }: Props) {
  const { colors } = useTheme()
  // Filled variants carry white content; muted uses the secondary text color.
  const fg = variant === 'muted' ? colors.txSecondary : '#ffffff'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      className={`h-[52px] w-full flex-row items-center justify-center gap-2 rounded-2xl ${FILL[variant]} ${disabled ? 'opacity-50' : ''}`}
    >
      {Icon ? <Icon size={17} color={fg} strokeWidth={2.4} /> : null}
      <AppText variant="bodySemibold" style={{ color: fg }}>{label}</AppText>
    </Pressable>
  )
}
