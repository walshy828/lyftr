import { describe, it, expect } from 'vitest'
import { initialClothingId } from './useClothingProfiles'
import type { ClothingProfile, WeightLog } from '../types'

const profiles: ClothingProfile[] = [
  { id: 1, name: 'Summer', offset_lbs: 0, is_default: true, sort_order: 0 },
  { id: 2, name: 'Winter', offset_lbs: 4, is_default: false, sort_order: 1 },
]
const log = (clothing_profile_id: number | null): WeightLog =>
  ({ id: 9, weight: 180, logged_at: '2026-10-01T12:00:00Z', clothing_profile_id })

describe('initialClothingId', () => {
  it('reuses the last entry\'s outfit', () => {
    expect(initialClothingId(profiles, log(2))).toBe(2)
  })
  it('falls back to the default when there is no history or the profile is gone', () => {
    expect(initialClothingId(profiles, null)).toBe(1)
    expect(initialClothingId(profiles, log(99))).toBe(1)
    expect(initialClothingId(profiles, log(null))).toBe(1)
  })
  it('is null before profiles load', () => {
    expect(initialClothingId([], log(2))).toBeNull()
  })
})
