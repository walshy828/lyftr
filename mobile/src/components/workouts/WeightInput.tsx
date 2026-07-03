import { TextInput, View } from 'react-native'
import { AppText } from '../ui'
import { useTheme } from '../../theme/useTheme'
import { useNumericText } from '../../hooks/useNumericText'

interface Props {
  /** Display-unit string in/out — caller owns lbs↔display conversion (web parity). */
  value: string
  onChange: (next: string) => void
  unit: string
  placeholder?: string
  accessibilityLabel?: string
}

// Port of web/components/WeightInput.tsx, compact (stepper={false} size="sm") mode
// only — the web's stepper mode backs bodyweight/gym-mode screens, which on mobile
// use StepperTile + NumberField instead. Raw typed text lives in useNumericText so a
// trailing "." or leading "0" isn't clobbered by the parent re-deriving `value` as a
// number each keystroke. Web blocks bad keys in onKeyDown; RN keyboards have no such
// hook, so the changed text is sanitized instead (same rules as ui/NumberField's
// decimal mode: digits + a single '.').
export function WeightInput({ value, onChange, unit, placeholder = '225', accessibilityLabel }: Props) {
  const { colors } = useTheme()
  const [text, setText] = useNumericText(value)

  const emit = (raw: string) => {
    let v = raw.replace(/[^0-9.]/g, '')
    const i = v.indexOf('.')
    if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '')
    setText(v)
    onChange(v)
  }

  return (
    <View className="h-10 flex-row items-center rounded-lg border border-surface-border bg-surface-overlay px-3">
      <TextInput
        value={text}
        onChangeText={emit}
        keyboardType="decimal-pad"
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor={colors.txMuted}
        accessibilityLabel={accessibilityLabel}
        className="flex-1 py-0 text-center font-sans text-sm text-tx-primary"
        style={{ fontVariant: ['tabular-nums'] }}
      />
      <AppText variant="caption" color="muted">{unit}</AppText>
    </View>
  )
}
