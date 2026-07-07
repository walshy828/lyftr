import { Image, Pressable, View } from 'react-native'
import { ChevronRight, Utensils } from 'lucide-react-native'
import type { FoodLog } from '@lyftr/shared'
import { AppText } from '../ui'
import { useTheme } from '../../theme/useTheme'
import { MACRO_TEXT } from './nutritionMeta'

interface Props {
  entry: FoodLog
  /** First row in a meal has no top divider. */
  first: boolean
  /** Tap the row to open the entry's view screen (edit/delete live there). */
  onPress: () => void
}

// A logged food entry row. Matches the weight/workouts list idiom: the whole row taps
// through to a view screen (which owns Edit/Delete top-right) — no inline actions here.
export function FoodEntryRow({ entry, first, onPress }: Props) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-3 px-4 py-3 active:bg-surface-muted/50 ${first ? '' : 'border-t border-surface-border'}`}
    >
      {entry.image_url ? (
        <Image source={{ uri: entry.image_url }} className="h-11 w-11 rounded-xl border border-surface-border" />
      ) : (
        <View className="h-11 w-11 items-center justify-center rounded-xl border border-surface-border bg-surface-muted">
          <Utensils size={20} color={colors.txMuted} style={{ opacity: 0.4 }} />
        </View>
      )}
      <View className="min-w-0 flex-1">
        <AppText variant="bodySemibold" numberOfLines={1}>{entry.name}</AppText>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2">
          <AppText variant="caption" color="secondary" style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>{Math.round(entry.calories)} kcal</AppText>
          <Dot />
          <AppText variant="caption" style={{ color: MACRO_TEXT.protein, fontVariant: ['tabular-nums'] }}>{entry.protein.toFixed(0)}g P</AppText>
          <Dot />
          <AppText variant="caption" style={{ color: MACRO_TEXT.carbs, fontVariant: ['tabular-nums'] }}>{entry.carbs.toFixed(0)}g C</AppText>
          <Dot />
          <AppText variant="caption" style={{ color: MACRO_TEXT.fat, fontVariant: ['tabular-nums'] }}>{entry.fat.toFixed(0)}g F</AppText>
          {entry.servings !== 1 ? <AppText variant="caption" color="muted">× {entry.servings}</AppText> : null}
        </View>
      </View>
      <ChevronRight size={16} color={colors.txMuted} />
    </Pressable>
  )
}

function Dot() {
  return <AppText variant="caption" color="muted" style={{ fontSize: 10 }}>·</AppText>
}
