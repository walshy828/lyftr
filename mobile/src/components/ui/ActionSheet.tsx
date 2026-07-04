import { Pressable, View } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { useTheme } from '../../theme/useTheme'
import { AppText } from './Typography'
import { SheetButton } from './SheetButton'
import { Sheet, SHEET_ANIM_MS } from './Sheet'

export interface SheetAction {
  label: string
  icon?: LucideIcon
  /** Destructive actions get a red icon badge + red label. */
  destructive?: boolean
  onPress: () => void
}

interface Props {
  open: boolean
  /** Small uppercase kicker (e.g. "Workout"). */
  title?: string
  /** The item the actions apply to (e.g. the workout name). */
  subtitle?: string
  actions: SheetAction[]
  cancelLabel?: string
  onClose: () => void
}

// A native-style options sheet — the kebab (⋮) menu other apps use. An optional
// title/subtitle header, a list of icon+label actions, and a Cancel, in the generic
// slide-up Sheet. An action's onPress fires *after* the sheet dismisses so a follow-up
// modal (e.g. a delete ConfirmSheet) isn't presented while this one is still closing.
export function ActionSheet({ open, title, subtitle, actions, cancelLabel = 'Cancel', onClose }: Props) {
  const { brand, accent, isDark } = useTheme()

  // errorSoft on dark, error on light — same split as ConfirmSheet/IconButton.
  const iconColor = (destructive?: boolean) =>
    destructive ? (isDark ? brand.errorSoft : brand.error) : accent

  const run = (onPress: () => void) => {
    onClose()
    setTimeout(onPress, SHEET_ANIM_MS)
  }

  return (
    <Sheet open={open} onClose={onClose} bottomInset={12} haptic="selection">
      <View className="px-3">
        {(title || subtitle) ? (
          <View className="items-center px-3 pb-3">
            {title ? (
              <AppText variant="label" color="muted" className="uppercase" style={{ letterSpacing: 1.5 }}>
                {title}
              </AppText>
            ) : null}
            {subtitle ? (
              <AppText variant="bodySemibold" numberOfLines={1} className="mt-0.5">{subtitle}</AppText>
            ) : null}
          </View>
        ) : null}

        {/* iOS-style grouped action list: one rounded card, hairline dividers inset
            past the icon. Reads as a premium menu instead of bare rows. */}
        <View className="overflow-hidden rounded-2xl border border-surface-border bg-surface-overlay">
          {actions.map((a, i) => (
            <View key={i}>
              {i > 0 ? <View className="ml-[60px] h-px bg-surface-border/70" /> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => run(a.onPress)}
                className="h-14 flex-row items-center gap-3 px-3.5 active:bg-surface-muted"
              >
                {a.icon ? (
                  <View
                    className={`h-9 w-9 items-center justify-center rounded-xl ${
                      a.destructive ? 'bg-error-500/15' : 'bg-brand-500/15'
                    }`}
                  >
                    <a.icon size={18} color={iconColor(a.destructive)} strokeWidth={2.2} />
                  </View>
                ) : null}
                <AppText
                  variant="bodySemibold"
                  style={a.destructive ? { color: iconColor(true) } : undefined}
                >
                  {a.label}
                </AppText>
              </Pressable>
            </View>
          ))}
        </View>

        <View className="mt-2.5">
          <SheetButton label={cancelLabel} variant="muted" onPress={onClose} />
        </View>
      </View>
    </Sheet>
  )
}
