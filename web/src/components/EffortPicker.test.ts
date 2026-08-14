import { describe, it, expect } from 'vitest'
import { effortToStored, storedToEffort } from './EffortPicker'

describe('effort scale conversion', () => {
  // Both scales persist to one column, so the conversion is the only thing
  // keeping a set rated on one comparable with a set rated on the other.
  it('stores RPE unchanged', () => {
    expect(effortToStored('rpe', 8)).toBe(8)
    expect(effortToStored('rpe', 10)).toBe(10)
  })

  it('inverts RIR, because 0 reps in reserve is maximal effort', () => {
    expect(effortToStored('rir', 0)).toBe(10)
    expect(effortToStored('rir', 2)).toBe(8)
    expect(effortToStored('rir', 5)).toBe(5)
  })

  it('round-trips on both scales', () => {
    for (const v of [6, 7.5, 8, 9.5, 10]) {
      expect(storedToEffort('rpe', effortToStored('rpe', v))).toBe(v)
    }
    for (const v of [0, 1, 2, 3, 4, 5]) {
      expect(storedToEffort('rir', effortToStored('rir', v))).toBe(v)
    }
  })

  // The two scales must agree about the same set: 2 reps in reserve IS RPE 8.
  it('maps equivalent ratings to the same stored value', () => {
    expect(effortToStored('rir', 2)).toBe(effortToStored('rpe', 8))
    expect(effortToStored('rir', 0)).toBe(effortToStored('rpe', 10))
  })
})
