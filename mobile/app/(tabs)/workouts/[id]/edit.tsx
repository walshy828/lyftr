import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import {
  AlertCircle, ArrowLeft, Clock, Dumbbell, FileText, Plus, Trash2, Zap,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import {
  apiErrorMessage, displayToLbs, lbsToDisplay, weightShort, type Exercise,
} from '@lyftr/shared'
import { AppText, Button, Field, IconButton, Label, Screen } from '../../../../src/components/ui'
import { ExercisePicker } from '../../../../src/components/workouts/ExercisePicker'
import { WeightInput } from '../../../../src/components/workouts/WeightInput'
import { client, useSettingsStore } from '../../../../src/lib/lyftr'
import { useTheme } from '../../../../src/theme/useTheme'

// Web's edit-form shape: NO date, NO rest_seconds (the edit screen doesn't touch
// rest — web parity). Weights/duration in DISPLAY units; converted on submit.
interface WorkoutFormData {
  name: string
  notes: string
  duration: number
  exercises: {
    exercise_id: number
    notes: string
    sets: { set_number: number; reps: number; weight: number }[]
  }[]
}

// See new.tsx — same compact-row rationale (static border, no focus glow).
const COMPACT_INPUT = 'h-10 rounded-lg border border-surface-border bg-surface-overlay px-3 font-sans text-sm text-tx-primary'

function FieldHeader({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  const { accent } = useTheme()
  return (
    <View className="mb-2 flex-row items-center gap-2">
      <Icon size={14} color={accent} strokeWidth={2.2} />
      <Label>{label}</Label>
    </View>
  )
}

export default function EditWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const settings = useSettingsStore((s) => s.settings)
  const fetchSettings = useSettingsStore((s) => s.fetch)
  const wUnit = weightShort(settings.weight_unit)
  const { colors, brand, accent, isDark } = useTheme()

  const [showPicker, setShowPicker] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [pickerExercises, setPickerExercises] = useState<Record<number, Exercise>>({})
  const [formData, setFormData] = useState<WorkoutFormData>({ name: '', notes: '', duration: 0, exercises: [] })
  const [originalStartedAt, setOriginalStartedAt] = useState('')
  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    if (error) scrollRef.current?.scrollTo({ y: 0, animated: true })
  }, [error])

  useEffect(() => {
    const workoutId = Number(id)
    if (!workoutId) {
      router.replace('/workouts')
      return
    }
    client.workoutAPI.get(workoutId)
      .then((workout) => {
        const map: Record<number, Exercise> = {}
        ;(workout.exercises || []).forEach((ex) => { map[ex.exercise_id] = ex.exercise })
        setPickerExercises(map)
        // The date is immutable in edit: keep the original timestamp for the payload.
        setOriginalStartedAt(workout.started_at || new Date().toISOString())
        setFormData({
          name: workout.name,
          notes: workout.notes || '',
          duration: Math.round(workout.duration / 60),
          exercises: (workout.exercises || []).map((ex) => ({
            exercise_id: ex.exercise_id,
            notes: ex.notes || '',
            // Web parity: unrounded lbsToDisplay prefill (kg users see long decimals).
            sets: (ex.sets || []).map((s) => ({
              set_number: s.set_number,
              reps: s.reps,
              weight: lbsToDisplay(s.weight, settings.weight_unit),
            })),
          })),
        })
      })
      .catch(() => setError('Failed to load workout'))
      .finally(() => setInitialLoading(false))
    // Web effect deps: [id] only — settings are fetched before a user can navigate here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/workouts'))

  const addExercise = (exercise: Exercise) => {
    setPickerExercises((prev) => ({ ...prev, [exercise.id]: exercise }))
    setFormData((prev) => ({
      ...prev,
      exercises: [
        ...prev.exercises,
        { exercise_id: exercise.id, notes: '', sets: [{ set_number: 1, reps: 0, weight: 0 }] },
      ],
    }))
    setShowPicker(false)
    setError('')
  }

  const removeExercise = (index: number) =>
    setFormData((prev) => ({ ...prev, exercises: prev.exercises.filter((_, i) => i !== index) }))

  const addSet = (exIdx: number) => {
    setFormData((prev) => {
      const exercises = [...prev.exercises]
      exercises[exIdx].sets.push({ set_number: exercises[exIdx].sets.length + 1, reps: 0, weight: 0 })
      return { ...prev, exercises }
    })
  }

  const removeSet = (exIdx: number, setIdx: number) => {
    setFormData((prev) => {
      const exercises = [...prev.exercises]
      exercises[exIdx].sets = exercises[exIdx].sets.filter((_, i) => i !== setIdx)
      return { ...prev, exercises }
    })
  }

  const updateSet = (exIdx: number, setIdx: number, field: 'reps' | 'weight', value: string) => {
    setFormData((prev) => {
      const exercises = [...prev.exercises]
      exercises[exIdx].sets[setIdx][field] = Number(value) || 0
      return { ...prev, exercises }
    })
  }

  const updateExNotes = (exIdx: number, text: string) => {
    setFormData((prev) => {
      const exercises = [...prev.exercises]
      exercises[exIdx] = { ...exercises[exIdx], notes: text }
      return { ...prev, exercises }
    })
  }

  const handleSubmit = async () => {
    if (!formData.name.trim()) { setError('Workout name required'); return }
    if (formData.exercises.length === 0) { setError('Add at least one exercise'); return }
    setLoading(true)
    try {
      const payload = {
        ...formData,
        duration: formData.duration * 60,
        started_at: originalStartedAt || new Date().toISOString(),
        exercises: formData.exercises.map((ex) => ({
          ...ex,
          sets: ex.sets.map((s) => ({ ...s, weight: displayToLbs(s.weight, settings.weight_unit) })),
        })),
      }
      await client.workoutAPI.update(Number(id), payload)
      // Web navigates to /workouts. Pop past the (stale) detail screen back to the
      // list — the detail refetches on next visit; the list reloads on focus.
      router.dismissTo('/workouts')
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update workout'))
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator color={accent} />
      </Screen>
    )
  }

  const selectedIds = formData.exercises.map((e) => e.exercise_id)
  const totalSets = formData.exercises.reduce((sum, ex) => sum + ex.sets.length, 0)
  const totalWeight = formData.exercises.reduce(
    (sum, ex) => sum + ex.sets.reduce((s, set) => s + (set.weight || 0), 0),
    0
  )

  return (
    <Screen>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-6 py-4">
          <View className="flex-row items-center gap-3">
            <IconButton icon={ArrowLeft} label="Back" variant="ghost" size="md" onPress={goBack} />
            <View>
              <AppText variant="title">Edit Workout</AppText>
              <AppText variant="caption" color="muted">
                {formData.exercises.length} exercises • {totalSets} sets
              </AppText>
            </View>
          </View>

          {error ? (
            <View className="flex-row items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 p-4">
              <AlertCircle size={16} color={isDark ? brand.errorSoft : brand.error} />
              <AppText variant="body" color="error" className="flex-1">{error}</AppText>
            </View>
          ) : null}

          <View>
            <FieldHeader icon={Dumbbell} label="Workout Name" />
            <Field
              value={formData.name}
              onChangeText={(t) => setFormData((prev) => ({ ...prev, name: t }))}
            />
          </View>

          <View>
            <FieldHeader icon={Clock} label="Duration (minutes)" />
            <View className="flex-row gap-3">
              <Field
                className="flex-1"
                value={formData.duration ? String(formData.duration) : ''}
                onChangeText={(t) =>
                  setFormData((prev) => ({ ...prev, duration: Number(t.replace(/[^0-9]/g, '')) || 0 }))
                }
                keyboardType="number-pad"
                returnKeyType="done"
                placeholder="0"
              />
              <View className="flex-1 justify-center rounded-lg bg-surface-muted/30 px-3">
                <AppText variant="body" color="muted">
                  {Math.floor(formData.duration / 60)}h {formData.duration % 60}m
                </AppText>
              </View>
            </View>
          </View>

          <View>
            <FieldHeader icon={FileText} label="Notes" />
            <Field
              value={formData.notes}
              onChangeText={(t) => setFormData((prev) => ({ ...prev, notes: t }))}
              multiline
            />
          </View>

          {formData.exercises.length > 0 && (
            <View className="flex-row rounded-lg border border-brand-500/20 bg-brand-500/10 p-3">
              <View className="flex-1 items-center">
                <AppText variant="subheading" color="brand" style={{ fontVariant: ['tabular-nums'] }}>
                  {formData.exercises.length}
                </AppText>
                <AppText variant="caption" color="muted">Exercises</AppText>
              </View>
              <View className="flex-1 items-center">
                <AppText variant="subheading" color="brand" style={{ fontVariant: ['tabular-nums'] }}>
                  {totalSets}
                </AppText>
                <AppText variant="caption" color="muted">Sets</AppText>
              </View>
              <View className="flex-1 items-center">
                <AppText variant="subheading" color="brand" style={{ fontVariant: ['tabular-nums'] }}>
                  {Math.round(totalWeight)}
                </AppText>
                <AppText variant="caption" color="muted">Total {wUnit}</AppText>
              </View>
            </View>
          )}

          <View>
            <View className="mb-3 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Zap size={14} color={accent} strokeWidth={2.2} />
                <Label>Exercises</Label>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowPicker(true)}
                className="flex-row items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 active:scale-95"
              >
                <Plus size={13} color="#ffffff" />
                <Text className="font-sans-semibold text-xs text-white">Add Exercise</Text>
              </Pressable>
            </View>

            <View className="gap-4">
              {formData.exercises.map((workoutEx, exIdx) => {
                const exercise = pickerExercises[workoutEx.exercise_id]
                return (
                  <View key={exIdx} className="rounded-lg border border-surface-border bg-surface-muted/30 p-4">
                    <View className="mb-4 flex-row items-start justify-between">
                      <View className="flex-1">
                        <View className="mb-1 flex-row items-center gap-2">
                          <View className="h-6 w-6 items-center justify-center rounded bg-brand-500/20">
                            <AppText variant="caption" color="brand" style={{ fontVariant: ['tabular-nums'] }}>
                              {exIdx + 1}
                            </AppText>
                          </View>
                          <AppText variant="bodySemibold" className="flex-1" numberOfLines={1}>
                            {exercise?.name}
                          </AppText>
                        </View>
                        <AppText variant="caption" color="muted" className="ml-8">
                          {exercise?.muscle_group} • {exercise?.equipment}
                        </AppText>
                      </View>
                      <IconButton
                        icon={Trash2}
                        label={`Remove ${exercise?.name ?? 'exercise'}`}
                        variant="danger"
                        size="sm"
                        onPress={() => removeExercise(exIdx)}
                      />
                    </View>

                    <View className="mb-4">
                      <Label className="mb-1">Notes</Label>
                      <TextInput
                        value={workoutEx.notes}
                        onChangeText={(t) => updateExNotes(exIdx, t)}
                        placeholderTextColor={colors.txMuted}
                        className={COMPACT_INPUT}
                      />
                    </View>

                    {/* No RestPicker here — web's edit form doesn't touch rest_seconds. */}

                    <View className="mb-3 gap-2">
                      <View className="flex-row items-center justify-between">
                        <Label>Sets</Label>
                        <AppText variant="caption" color="muted">{workoutEx.sets.length} sets</AppText>
                      </View>
                      {workoutEx.sets.map((set, setIdx) => (
                        <View
                          key={setIdx}
                          className="flex-row items-end gap-2 rounded-lg border border-surface-border/50 bg-surface-raised/40 p-3"
                        >
                          <View className="w-10">
                            <Label className="mb-1">Set</Label>
                            <View className="items-center rounded bg-surface-muted px-2 py-2">
                              <AppText variant="subheading" style={{ fontVariant: ['tabular-nums'] }}>
                                {set.set_number}
                              </AppText>
                            </View>
                          </View>
                          <View className="flex-1">
                            <Label className="mb-1">Reps</Label>
                            <TextInput
                              value={set.reps ? String(set.reps) : ''}
                              onChangeText={(t) => updateSet(exIdx, setIdx, 'reps', t.replace(/[^0-9]/g, ''))}
                              keyboardType="number-pad"
                              returnKeyType="done"
                              placeholder="10"
                              placeholderTextColor={colors.txMuted}
                              accessibilityLabel="Set reps"
                              className={`${COMPACT_INPUT} text-center`}
                              style={{ fontVariant: ['tabular-nums'] }}
                            />
                          </View>
                          <View className="flex-1">
                            <Label className="mb-1">Weight</Label>
                            <WeightInput
                              value={set.weight ? String(set.weight) : ''}
                              onChange={(v) => updateSet(exIdx, setIdx, 'weight', v)}
                              unit={wUnit}
                              placeholder="225"
                              accessibilityLabel="Set weight"
                            />
                          </View>
                          <IconButton
                            icon={Trash2}
                            label="Remove set"
                            variant="danger"
                            size="sm"
                            className="mb-1"
                            onPress={() => removeSet(exIdx, setIdx)}
                          />
                        </View>
                      ))}
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      onPress={() => addSet(exIdx)}
                      className="flex-row items-center gap-1 self-start py-1 active:opacity-60"
                    >
                      <Plus size={13} color={accent} />
                      <Text className="font-sans-semibold text-xs" style={{ color: accent }}>Add Set</Text>
                    </Pressable>
                  </View>
                )
              })}
            </View>
          </View>

          <View className="flex-row gap-3 pt-2">
            <Button title="Cancel" variant="secondary" className="flex-1" onPress={goBack} />
            <Button title="Save Changes" className="flex-1" onPress={handleSubmit} loading={loading} />
          </View>
        </View>
      </ScrollView>

      {showPicker && (
        <ExercisePicker selectedIds={selectedIds} onSelect={addExercise} onClose={() => setShowPicker(false)} />
      )}
    </Screen>
  )
}
