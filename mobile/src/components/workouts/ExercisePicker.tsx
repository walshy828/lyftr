import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ArrowLeft } from 'lucide-react-native'
import type { Exercise } from '@lyftr/shared'
import { AppText, Field, IconButton } from '../ui'
import { client } from '../../lib/lyftr'
import { useTheme } from '../../theme/useTheme'
import { EQUIPMENT_LABEL, muscleColor } from '../../utils/exerciseUtils'
import { ExerciseImage } from './ExerciseImage'

interface Props {
  selectedIds: number[]
  onSelect: (exercise: Exercise) => void
  onClose: () => void
}

const MAX_SHOWN = 40

function PickerRow({ exercise, onPress }: { exercise: Exercise; onPress: () => void }) {
  const { colors } = useTheme()
  const tint = muscleColor(exercise.muscle_group)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-surface-muted"
    >
      <ExerciseImage url={exercise.image_url} />
      <View className="flex-1">
        <AppText variant="subheading" numberOfLines={1}>{exercise.name}</AppText>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
          {/* Bordered muscle badge (web muscleColorBordered); text tint inline — see exerciseUtils. */}
          <View className={`rounded border px-1.5 py-0.5 ${tint ? `${tint.chip} ${tint.border}` : 'bg-surface-muted border-surface-border'}`}>
            <AppText variant="caption" style={{ color: tint?.text ?? colors.txMuted }}>
              {exercise.muscle_group}
            </AppText>
          </View>
          {exercise.equipment && exercise.equipment !== 'other' ? (
            <AppText variant="caption" color="muted">
              {EQUIPMENT_LABEL[exercise.equipment] || exercise.equipment}
            </AppText>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

// Port of web/components/ExercisePicker.tsx as a full-screen RN Modal (the web
// portals a fixed overlay; the caller conditionally mounts us the same way, so
// search state resets per open — a routed screen can't hand the picked Exercise
// back to the form without a store detour, hence Modal).
export function ExercisePicker({ selectedIds, onSelect, onClose }: Props) {
  const { accent } = useTheme()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)

  // One debounced loader (250ms, web parity); the empty query is served instantly —
  // the client caches the unfiltered exercise list after the first fetch.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await client.exerciseAPI.list(query ? { q: query } : undefined)
        if (!cancelled) setExercises(data || [])
      } catch {
        // Web swallows picker fetch errors too — the empty state covers it.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, query ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const available = exercises.filter((e) => !selectedIds.includes(e.id))
  const shown = available.slice(0, MAX_SHOWN)

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-surface-base" edges={['top']}>
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
          <IconButton icon={ArrowLeft} label="Close exercise picker" variant="ghost" size="md" onPress={onClose} />
          <View>
            <AppText variant="heading">Add Exercise</AppText>
            <AppText variant="caption" color="muted">{available.length} available</AppText>
          </View>
        </View>

        {/* Search */}
        <View className="border-b border-surface-border px-4 py-3">
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, muscle, equipment…"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        {/* List */}
        {loading && exercises.length === 0 ? (
          <View className="flex-row items-center justify-center gap-2 py-16">
            <ActivityIndicator color={accent} />
            <AppText variant="body" color="muted">Loading exercises…</AppText>
          </View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(e) => String(e.id)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
            renderItem={({ item }) => <PickerRow exercise={item} onPress={() => onSelect(item)} />}
            ListEmptyComponent={
              <View className="items-center py-16">
                <AppText variant="body" color="muted">No exercises found</AppText>
              </View>
            }
            ListFooterComponent={
              available.length > MAX_SHOWN ? (
                <AppText variant="caption" color="muted" className="py-3 text-center">
                  Showing {MAX_SHOWN} of {available.length} — refine search
                </AppText>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  )
}
