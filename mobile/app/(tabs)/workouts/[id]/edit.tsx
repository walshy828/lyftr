import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import {
  AlertCircle, ArrowLeft, Clock, Dumbbell, FileText, Plus, Zap,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import {
  apiErrorMessage, displayToLbs, lbsToDisplay, weightShort, type Exercise,
} from '@lyftr/shared'
import { AppText, Button, EmptyState, Field, IconButton, Label, Screen } from '../../../../src/components/ui'
import { ExerciseFormCard } from '../../../../src/components/workouts/ExerciseFormCard'
import { ExercisePicker } from '../../../../src/components/workouts/ExercisePicker'
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

function FieldHeader({ icon: Icon, label, hint }: { icon: LucideIcon; label: string; hint?: string }) {
  // Muted (not accent) field icons — matches new.tsx: with every header cyan the
  // form reads busy; the accent stays reserved for the Exercises section + CTA.
  const { colors } = useTheme()
  return (
    <View className="mb-2 flex-row items-center gap-2">
      <Icon size={14} color={colors.txMuted} strokeWidth={2.2} />
      <Label>{label}</Label>
      {hint ? <AppText variant="caption" color="muted">{hint}</AppText> : null}
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
        contentContainerStyle={{ paddingBottom: 24 }}
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
                {totalWeight > 0 ? ` • ${Math.round(totalWeight)} ${wUnit}` : ''}
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
            <FieldHeader
              icon={Clock}
              label="Duration (min)"
              // h/m readout only once it means something — "0h 5m" is noise.
              hint={formData.duration >= 60
                ? `= ${Math.floor(formData.duration / 60)}h ${formData.duration % 60}m`
                : undefined}
            />
            <Field
              value={formData.duration ? String(formData.duration) : ''}
              onChangeText={(t) =>
                setFormData((prev) => ({ ...prev, duration: Number(t.replace(/[^0-9]/g, '')) || 0 }))
              }
              keyboardType="number-pad"
              returnKeyType="done"
              placeholder="0"
            />
          </View>

          <View>
            <FieldHeader icon={FileText} label="Notes" />
            <Field
              value={formData.notes}
              onChangeText={(t) => setFormData((prev) => ({ ...prev, notes: t }))}
              multiline
            />
          </View>

          {/* No summary strip — the header caption already carries exercises · sets · total. */}
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

            {formData.exercises.length === 0 && (
              <View className="rounded-2xl border border-dashed border-surface-border">
                <EmptyState
                  compact
                  icon={Dumbbell}
                  title="No exercises"
                  subtitle="Add an exercise to this workout"
                />
              </View>
            )}

            <View className="gap-4">
              {/* No RestPicker footer here — web's edit form doesn't touch rest_seconds. */}
              {formData.exercises.map((workoutEx, exIdx) => (
                <ExerciseFormCard
                  key={exIdx}
                  index={exIdx}
                  exercise={pickerExercises[workoutEx.exercise_id]}
                  notes={workoutEx.notes}
                  sets={workoutEx.sets}
                  unit={wUnit}
                  onRemove={() => removeExercise(exIdx)}
                  onNotesChange={(t) => updateExNotes(exIdx, t)}
                  onAddSet={() => addSet(exIdx)}
                  onRemoveSet={(setIdx) => removeSet(exIdx, setIdx)}
                  onUpdateSet={(setIdx, field, v) => updateSet(exIdx, setIdx, field, v)}
                />
              ))}
            </View>
          </View>

        </View>
      </ScrollView>

      {/* Sticky footer actions — Save stays reachable however long the form grows.
          -mx-5 lets the divider span edge-to-edge past Screen's px-5. */}
      <View className="-mx-5 flex-row gap-3 border-t border-surface-border bg-surface-base px-5 pb-2 pt-3">
        <Button title="Cancel" variant="secondary" className="flex-1" onPress={goBack} />
        <Button title="Save Changes" className="flex-1" onPress={handleSubmit} loading={loading} />
      </View>

      {showPicker && (
        <ExercisePicker selectedIds={selectedIds} onSelect={addExercise} onClose={() => setShowPicker(false)} />
      )}
    </Screen>
  )
}
