import { useState } from 'react'
import { Platform, Pressable, View } from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { CalendarDays } from 'lucide-react-native'
import { format } from 'date-fns'
import { useTheme } from '../../theme/useTheme'
import { AppText, Label } from './Typography'

interface Props {
  label?: string
  /** ISO calendar date, YYYY-MM-DD — same value shape as web's <input type=date>. */
  value: string
  onChange: (next: string) => void
  /** Upper bound (e.g. new Date() = today) — mirrors the web input's `max`. */
  maximumDate?: Date
}

// new Date('YYYY-MM-DD') parses as UTC midnight, which *displays* as the previous
// day in negative-offset timezones — so the picker round-trips through local date
// parts. The form's payload keeps web's exact `new Date(date).toISOString()`.
const toLocalDate = (v: string): Date => {
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
const pad = (n: number) => String(n).padStart(2, '0')
const toValue = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Mirrors web ui/DateInput / <input type=date>: a Field-look row that opens the
// platform date picker. Android's picker is a self-dismissing dialog; iOS renders
// the inline calendar under the row and collapses once a day is picked. No
// focus-reactive TextInput here, so no Reanimated glow is needed (Fabric-safe by
// construction).
export function DateInput({ label, value, onChange, maximumDate }: Props) {
  const { colors, isDark } = useTheme()
  const [open, setOpen] = useState(false)
  const date = toLocalDate(value)

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Close on any terminal event: Android fires exactly once (set|dismissed) and
    // the dialog is already gone; iOS inline fires 'set' per day-tap — collapse then.
    setOpen(false)
    if (event.type === 'set' && selected) onChange(toValue(selected))
  }

  return (
    <View className="gap-1.5">
      {label ? <Label>{label}</Label> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? 'Pick date'}
        onPress={() => setOpen((o) => !o)}
        className="h-12 flex-row items-center gap-2.5 rounded-lg border border-surface-border bg-surface-overlay px-3.5 active:scale-[0.99]"
      >
        <CalendarDays size={16} color={colors.txMuted} />
        <AppText variant="body">{format(date, 'MMM d, yyyy')}</AppText>
      </Pressable>
      {open && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          maximumDate={maximumDate}
          onChange={handleChange}
          themeVariant={isDark ? 'dark' : 'light'}
        />
      )}
    </View>
  )
}
