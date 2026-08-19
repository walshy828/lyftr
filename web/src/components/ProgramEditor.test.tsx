import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ProgramEditor, { ProgramFormData } from './ProgramEditor'
import * as types from '../types'

vi.mock('./ExercisePicker', () => ({
  default: ({ onSelect }: { onSelect: (e: types.Exercise) => void }) => (
    <>
      <button onClick={() => onSelect({ id: 2, name: 'Deadlift', muscle_group: 'back', category: 'strength', equipment: 'barbell', secondary_muscles: [], description: '' })}>
        pick-deadlift
      </button>
      <button onClick={() => onSelect({ id: 3, name: 'Plank', muscle_group: 'core', category: 'strength', equipment: '', secondary_muscles: [], description: '', is_timed: true, default_duration_seconds: 45 })}>
        pick-plank
      </button>
    </>
  ),
}))

const EMPTY: ProgramFormData = { name: '', notes: '', exercises: [] }

const WITH_EXERCISE: ProgramFormData = {
  name: 'PPL',
  notes: '',
  exercises: [{ exercise_id: 1, notes: '', rest_seconds: 90, sets: [{ set_number: 1, target_reps: 5, target_weight: 100 }] }],
}
const PICKER_EXERCISES = { 1: { id: 1, name: 'Squat', muscle_group: 'legs', category: 'strength', equipment: 'barbell', secondary_muscles: [], description: '' } }

describe('ProgramEditor', () => {
  it('requires a name and at least one exercise before saving', async () => {
    const onSave = vi.fn()
    render(<ProgramEditor initialData={EMPTY} title="New Program" onSave={onSave} onCancel={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /save program/i }))
    await waitFor(() => expect(screen.getByText(/program name required/i)).toBeTruthy())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('adds an exercise via the picker and saves the full payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ProgramEditor initialData={EMPTY} title="New Program" onSave={onSave} onCancel={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/push pull legs/i), { target: { value: 'My Program' } })
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }))
    fireEvent.click(screen.getByText('pick-deadlift'))
    fireEvent.click(screen.getByRole('button', { name: /save program/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'My Program',
      exercises: [expect.objectContaining({ exercise_id: 2 })],
    })))
  })

  it('renders initialData with resolved exercise names from initialPickerExercises', () => {
    render(
      <ProgramEditor
        initialData={WITH_EXERCISE}
        initialPickerExercises={PICKER_EXERCISES}
        title="Edit Program"
        onSave={vi.fn()}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Squat')).toBeTruthy()
  })

  it('embedded variant uses custom save/cancel labels', () => {
    render(
      <ProgramEditor
        variant="embedded"
        initialData={WITH_EXERCISE}
        initialPickerExercises={PICKER_EXERCISES}
        title="Draft"
        saveLabel="Create Program"
        cancelLabel="Discard"
        onSave={vi.fn()}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Create Program' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
  })

  it('shows a duration field (not reps/weight) for a timed exercise, seeded from its default', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ProgramEditor initialData={EMPTY} title="New Program" onSave={onSave} onCancel={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/push pull legs/i), { target: { value: 'Mobility' } })
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }))
    fireEvent.click(screen.getByText('pick-plank'))

    expect(screen.getByText(/target duration/i)).toBeTruthy()
    expect(screen.queryByText(/target reps/i)).toBeNull()
    expect(screen.queryByText(/target weight/i)).toBeNull()
    expect(screen.getByPlaceholderText('30')).toHaveProperty('value', '45')

    fireEvent.click(screen.getByRole('button', { name: /save program/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      exercises: [expect.objectContaining({
        exercise_id: 3,
        sets: [expect.objectContaining({ target_duration_seconds: 45 })],
      })],
    })))
  })

  it('removing an exercise updates the exercise/set count', () => {
    render(
      <ProgramEditor
        initialData={WITH_EXERCISE}
        initialPickerExercises={PICKER_EXERCISES}
        title="Edit Program"
        onSave={vi.fn()}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('1 exercises • 1 sets')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /remove exercise/i }))
    expect(screen.getByText('0 exercises • 0 sets')).toBeTruthy()
  })
})
