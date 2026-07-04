import { useEffect } from 'react'
import { Modal, Pressable, View } from 'react-native'
import Animated, { Easing, SlideInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import type { LucideIcon } from 'lucide-react-native'
import { useTheme } from '../../theme/useTheme'
import { AppText } from './Typography'

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

// A native-style options sheet — the kebab (⋮) menu other apps use. Slides up from
// the bottom over a fading scrim with a grabber, an optional title/subtitle, a list
// of icon+label actions, and a Cancel. Built on the same conventions as ConfirmSheet
// (real root insets, scrim-fade + sheet-slide, ease-out timing, open haptic).
//
// An action's onPress fires *after* the sheet closes, so a follow-up modal (e.g. a
// delete ConfirmSheet) isn't presented while this one is still dismissing.
export function ActionSheet({ open, title, subtitle, actions, cancelLabel = 'Cancel', onClose }: Props) {
  const insets = useSafeAreaInsets()
  const { brand, accent, isDark } = useTheme()

  useEffect(() => {
    if (!open) return
    Haptics.selectionAsync().catch(() => {})
  }, [open])

  if (!open) return null

  // errorSoft on dark, error on light — same split as ConfirmSheet/IconButton.
  const iconColor = (destructive?: boolean) =>
    destructive ? (isDark ? brand.errorSoft : brand.error) : accent

  const run = (onPress: () => void) => {
    onClose()
    // Let the dismiss animation start before any follow-up modal mounts.
    setTimeout(onPress, 220)
  }

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/60" onPress={onClose}>
        <Animated.View entering={SlideInDown.duration(240).easing(Easing.out(Easing.cubic))}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ paddingBottom: insets.bottom + 12 }}
            className="rounded-t-3xl border border-surface-border bg-surface-base px-3 pt-3"
          >
            <View className="mx-auto mb-2 h-1 w-10 rounded-full bg-surface-muted" />

            {(title || subtitle) ? (
              <View className="items-center px-3 pb-2 pt-1">
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

            <View className="border-t border-surface-border/50 pt-1.5">
              {actions.map((a, i) => (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  onPress={() => run(a.onPress)}
                  className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-surface-muted"
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
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              className="mt-2 h-12 items-center justify-center rounded-2xl bg-surface-muted active:opacity-70"
            >
              <AppText variant="bodySemibold" color="secondary">{cancelLabel}</AppText>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  )
}
