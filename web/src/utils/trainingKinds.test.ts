import { describe, it, expect } from 'vitest'
import { inferModality, suggestKind, kindsOf } from './trainingKinds'
import type { Exercise } from '../types'

const ex = (id: number, name: string, category: string, extra: Partial<Exercise> = {}): Exercise =>
  ({ id, name, category, muscle_group: '', secondary_muscles: [], equipment: '', description: '', ...extra })

// Mirrors backend TestInferModality_goAndSQLAgree — keep the cases in step.
describe('inferModality', () => {
  it.each([
    ['Barbell Squat', 'strength', undefined, 'strength'],
    ['hamstring stretch', 'upper legs', 'gymvisual', 'mobility'],
    ['butterfly yoga pose', 'upper legs', 'gymvisual', 'mobility'],
    ['Pigeon', 'stretching', 'free', 'mobility'],
    ['Walk', 'cardio', 'baseline', 'cardio'],
    ['ankle circles', 'lower legs', 'gymvisual', 'strength'],
  ])('%s → %s', (name, category, source, want) => {
    expect(inferModality({ name, category, source })).toBe(want)
  })
})

describe('suggestKind', () => {
  const squat = ex(1, 'Squat', 'strength')
  const s1 = ex(2, 'Couch Stretch', 'upper legs')
  const s2 = ex(3, 'Hamstring Stretch', 'upper legs')
  const walk = ex(4, 'Walk', 'cardio')

  it('names a clear majority, treats a split as mixed', () => {
    expect(suggestKind([s1, s2, squat])).toBe('mobility')
    expect(suggestKind([squat, walk])).toBe('mixed')
    expect(suggestKind([])).toBe('strength')
  })

  it('prefers a stored modality over the name rule', () => {
    expect(suggestKind([ex(5, 'ankle circles', 'lower legs', { modality: 'mobility' })])).toBe('mobility')
  })

  it('counts distinct exercises, like the server', () => {
    expect(suggestKind([squat, squat, squat, s1, s2])).toBe('mobility')
  })
})

describe('kindsOf', () => {
  it('expands mixed into the types its exercises span', () => {
    expect(kindsOf('mixed', [ex(1, 'Squat', 'strength'), ex(2, 'Calf Stretch', 'stretching')])).toEqual(['strength', 'mobility'])
    expect(kindsOf('cardio', [])).toEqual(['cardio'])
  })
})
