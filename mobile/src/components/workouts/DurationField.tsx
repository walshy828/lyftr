import { Pressable, Text, TextInput, View } from 'react-native'
import { Minus, Plus } from 'lucide-react-native'
import { useTheme } from '../../theme/useTheme'

// A thumb-friendly duration input: −/+ steppers (±5 min) around a still-typeable
// value with a "min" suffix, so common durations are a tap or two and no keyboard —
// but an exact value is still one tap-to-type away. Replaces the bare number box.
// Value + onChange are in whole MINUTES (same as the form's formData.duration), so
// the payload construction upstream is unchanged.
const STEP = 5

function StepButton({ icon: Icon, onPress, disabled }: {
  icon: typeof Minus
  onPress: () => void
  disabled?: boolean
}) {
  const { colors, accent } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      className={`h-12 w-11 items-center justify-center rounded-xl border border-surface-border bg-surface-overlay active:opacity-60 ${disabled ? 'opacity-40' : ''}`}
    >
      <Icon size={18} color={disabled ? colors.txMuted : accent} strokeWidth={2.4} />
    </Pressable>
  )
}

export function DurationField({ value, onChange, inputAccessoryViewID }: {
  value: number
  onChange: (minutes: number) => void
  inputAccessoryViewID?: string
}) {
  const { colors } = useTheme()
  const step = (delta: number) => onChange(Math.max(0, value + delta))
  return (
    <View className="flex-row items-center gap-2">
      <StepButton icon={Minus} onPress={() => step(-STEP)} disabled={value <= 0} />
      <View className="h-12 flex-1 flex-row items-center justify-center rounded-xl border border-surface-border bg-surface-overlay">
        <TextInput
          value={value ? String(value) : ''}
          onChangeText={(t) => onChange(Number(t.replace(/[^0-9]/g, '')) || 0)}
          keyboardType="number-pad"
          returnKeyType="done"
          selectTextOnFocus
          inputAccessoryViewID={inputAccessoryViewID}
          placeholder="0"
          placeholderTextColor={colors.txMuted}
          accessibilityLabel="Duration in minutes"
          className="min-w-[36px] py-0 text-center font-sans-bold text-base text-tx-primary"
          style={{ fontVariant: ['tabular-nums'] }}
        />
        <Text className="ml-1 font-sans text-sm text-tx-muted">min</Text>
      </View>
      <StepButton icon={Plus} onPress={() => step(STEP)} />
    </View>
  )
}
