import { Pressable, Text, TextInput, View } from 'react-native'
import { Minus, Plus } from 'lucide-react-native'
import { useTheme } from '../../theme/useTheme'

// A thumb-friendly duration input: one unified stepper — −/+ as integrated end
// segments (±5 min) around a still-typeable value with a "min" suffix. Common
// durations are a tap or two and no keyboard; an exact value is one tap-to-type away.
// Value + onChange are whole MINUTES (same as the form's formData.duration), so the
// payload upstream is unchanged.
const STEP = 5
// One shared line box for the value (16pt bold) and the "min" label (14pt) so
// vertical centering lines them up on the same optical line.
const LINE = 20
// Points to drop "min" so it lands on the value's iOS optical line. Calibrated on
// device (web centers the value, so it can't measure this) — bump if still high.
const MIN_NUDGE = 3.5

export function DurationField({ value, onChange, inputAccessoryViewID }: {
  value: number
  onChange: (minutes: number) => void
  inputAccessoryViewID?: string
}) {
  const { colors, accent } = useTheme()
  const step = (delta: number) => onChange(Math.max(0, value + delta))
  const canDec = value > 0

  return (
    <View className="h-12 flex-row items-stretch overflow-hidden rounded-xl border border-surface-border bg-surface-overlay">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease duration"
        onPress={() => step(-STEP)}
        disabled={!canDec}
        className={`w-8 items-center justify-center border-r border-surface-border active:bg-surface-muted ${canDec ? '' : 'opacity-40'}`}
      >
        <Minus size={16} color={canDec ? accent : colors.txMuted} strokeWidth={2.4} />
      </Pressable>

      {/* The value + "min" read as one centered group. This column is only ~1/3 of the
          row, so the control stays compact: slim ± end caps and a small "min". */}
      <View className="flex-1 flex-row items-center justify-center">
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
          className="py-0 text-center font-sans-bold text-base text-tx-primary"
          // Share one lineHeight across the value + "min" so items-center lines up
          // their text boxes exactly (iOS renders placeholder/value low otherwise).
          // includeFontPadding:false drops Android's extra glyph padding.
          style={{ fontVariant: ['tabular-nums'], minWidth: 14, maxWidth: 40, lineHeight: LINE, includeFontPadding: false }}
        />
        {/* Nudge "min" down to sit on the value's optical line (the bold value renders
            low within its line box on iOS); transform keeps it out of layout. */}
        <Text
          className="ml-0.5 font-sans text-xs text-tx-muted"
          style={{ lineHeight: LINE, transform: [{ translateY: MIN_NUDGE }] }}
        >
          min
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase duration"
        onPress={() => step(STEP)}
        className="w-8 items-center justify-center border-l border-surface-border active:bg-surface-muted"
      >
        <Plus size={16} color={accent} strokeWidth={2.4} />
      </Pressable>
    </View>
  )
}
