import { Text, TextInput, TextInputProps, View } from 'react-native'
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated'
import { useTheme } from '../../theme/useTheme'
import { Label } from './Typography'

interface Props extends TextInputProps {
  label?: string
  error?: string | null
  className?: string
}

// Labeled text field, mirrors the web `.input` + `.label` pattern, with a focus
// glow on the box.
//
// Focus styling runs through a Reanimated shared value, NOT React state: on the New
// Architecture (Fabric), a re-render fired from a TextInput's own onFocus immediately
// re-blurs the input (keyboard flashes up, then dismisses). Same fix as authui's
// IconInput — any focus-reactive input must follow it. The animated border lives on a
// wrapper (inline styles: animation-driven values are a documented className
// exception), so `className` applies to the outer container for layout tweaks.
export function Field({ label, error, className = '', onFocus, onBlur, ...rest }: Props) {
  const { colors, brand } = useTheme()
  const focus = useSharedValue(0)
  const boxStyle = useAnimatedStyle(() => ({
    borderColor: error
      ? brand.error
      : interpolateColor(focus.value, [0, 1], [colors.border, brand.cyan]),
  }))
  return (
    <View className={`gap-1.5 ${className}`}>
      {label ? <Label>{label}</Label> : null}
      <Reanimated.View
        style={[
          {
            height: 48,
            borderRadius: 8,
            borderWidth: 1,
            paddingHorizontal: 14,
            backgroundColor: colors.overlay,
            flexDirection: 'row',
            alignItems: 'center',
          },
          boxStyle,
        ]}
      >
        <TextInput
          className="flex-1 font-sans text-base text-tx-primary"
          placeholderTextColor={colors.txMuted}
          onFocus={(e) => {
            focus.value = withTiming(1, { duration: 150 })
            onFocus?.(e)
          }}
          onBlur={(e) => {
            focus.value = withTiming(0, { duration: 150 })
            onBlur?.(e)
          }}
          {...rest}
        />
      </Reanimated.View>
      {error ? <Text className="font-sans text-xs text-error-400">{error}</Text> : null}
    </View>
  )
}
