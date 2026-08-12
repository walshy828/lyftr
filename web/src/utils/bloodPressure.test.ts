import { describe, it, expect } from 'vitest'
import { classifyBP, BP_CATEGORIES, formatBP } from './bloodPressure'
import type { BPCategory } from '../types'

// These fixtures are deliberately the same values as
// backend/utils/bloodpressure_test.go's TestClassifyBP. The client classifier
// exists only for instant feedback while typing, so if the two ever disagree
// the user sees one category before saving and a different one after — this
// test is the thing that catches that.
const BOUNDARIES: Array<[number, number, BPCategory]> = [
  [115, 75, 'normal'],
  [119, 79, 'normal'],
  [120, 79, 'elevated'],
  [129, 79, 'elevated'],
  // The "or" rule: either number qualifies.
  [120, 80, 'stage1'],
  [110, 85, 'stage1'],
  [130, 79, 'stage1'],
  [139, 89, 'stage1'],
  [140, 89, 'stage2'],
  [139, 90, 'stage2'],
  // Crisis is strictly greater-than, so exactly 180/120 is still stage 2.
  [180, 120, 'stage2'],
  [181, 120, 'crisis'],
  [180, 121, 'crisis'],
  [88, 70, 'low'],
  [95, 55, 'low'],
  // A low systolic must not mask a high diastolic.
  [85, 95, 'stage2'],
]

describe('classifyBP', () => {
  it.each(BOUNDARIES)('classifies %i/%i as %s', (sys, dia, want) => {
    expect(classifyBP(sys, dia)).toBe(want)
  })

  it('has display metadata for every category it can return', () => {
    for (const [sys, dia] of BOUNDARIES) {
      expect(BP_CATEGORIES[classifyBP(sys, dia)]).toBeDefined()
    }
  })
})

describe('formatBP', () => {
  it('writes readings in the conventional systolic/diastolic form', () => {
    expect(formatBP(120, 80)).toBe('120/80')
  })

  it('rounds averaged values so a daily mean renders cleanly', () => {
    expect(formatBP(127.4, 82.6)).toBe('127/83')
  })
})
