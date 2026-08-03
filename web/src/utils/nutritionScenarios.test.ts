import { describe, it, expect } from 'vitest'
import { caloriesFromMacros, macroSplit, proteinScenario, carbRemainder } from './nutritionScenarios'

const base = { protein: 180, carbs: 150, fat: 60 } // 720 + 600 + 540 = 1860 kcal

describe('caloriesFromMacros', () => {
  it('applies the standard 4/4/9 factors', () => {
    expect(caloriesFromMacros(base)).toBe(1860)
  })
})

describe('macroSplit', () => {
  it('returns each macro’s share of the calories', () => {
    const split = macroSplit(base)
    expect(split.protein).toBeCloseTo(720 / 1860, 5)
    expect(split.carbs).toBeCloseTo(600 / 1860, 5)
    expect(split.fat).toBeCloseTo(540 / 1860, 5)
    expect(split.protein + split.carbs + split.fat).toBeCloseTo(1, 5)
  })

  it('returns zeros rather than NaN for an empty plan', () => {
    expect(macroSplit({ protein: 0, carbs: 0, fat: 0 })).toEqual({ protein: 0, carbs: 0, fat: 0 })
  })
})

describe('proteinScenario', () => {
  it('leaves the plan alone at full adherence', () => {
    const s = proteinScenario(base, 1)
    expect(s).toMatchObject({ protein: 180, carbs: 150, fat: 60, calories: 1860 })
  })

  it('holds calories constant when protein is cut', () => {
    const s = proteinScenario(base, 0.8)
    expect(s.protein).toBe(144)
    // The scenario is only useful if it doesn't quietly deepen the deficit.
    expect(caloriesFromMacros(s)).toBeCloseTo(1860, -1)
  })

  it('moves freed calories into carbs and fat by their existing split', () => {
    const s = proteinScenario(base, 0.8)
    const freed = 36 * 4 // 144 kcal
    // carbs hold 600 of the 1140 non-protein kcal
    expect(s.carbs).toBe(Math.round((600 + freed * (600 / 1140)) / 4))
    expect(s.fat).toBe(Math.round((540 + freed * (540 / 1140)) / 9))
    expect(s.carbs).toBeGreaterThan(base.carbs)
    expect(s.fat).toBeGreaterThan(base.fat)
  })

  it('flags rows that fall under the protein floor', () => {
    expect(proteinScenario(base, 0.8, 144).belowProteinFloor).toBe(false)
    expect(proteinScenario(base, 0.7, 144).belowProteinFloor).toBe(true)
    // No floor supplied — nothing to flag against.
    expect(proteinScenario(base, 0.5).belowProteinFloor).toBe(false)
  })

  it('sends everything to carbs when there is no carb/fat split to weight by', () => {
    const s = proteinScenario({ protein: 200, carbs: 0, fat: 0 }, 0.5)
    expect(s.fat).toBe(0)
    expect(s.carbs).toBe(100) // 400 freed kcal / 4
  })
})

describe('carbRemainder', () => {
  it('returns what is left of the calorie target after protein and fat', () => {
    expect(carbRemainder(2000, 180, 60)).toBe((2000 - 720 - 540) / 4)
  })

  it('never goes negative when protein and fat already exceed the target', () => {
    expect(carbRemainder(1000, 200, 80)).toBe(0)
  })
})
