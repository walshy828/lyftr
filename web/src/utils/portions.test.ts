import { describe, it, expect } from 'vitest'
import {
  buildUnitOptions, findUnit, amountToServings, amountToGrams,
  formatUnitHint, formatServingLabel, matchUnitForLabel, SERVING_UNIT_ID,
} from './portions'

const mayo = {
  serving_size: 'per 100g',
  serving_size_grams: 100,
  portions: [{ label: '1 tbsp', grams: 13.8 }, { label: '1 cup', grams: 220 }],
}

describe('buildUnitOptions', () => {
  it('offers serving, exact mass units, and every published portion', () => {
    const options = buildUnitOptions(mayo)
    expect(options.map(o => o.id)).toEqual([
      SERVING_UNIT_ID, 'g', 'oz', 'portion:1 tbsp', 'portion:1 cup',
    ])
    expect(options[1].grams).toBe(1)
    expect(options[2].grams).toBeCloseTo(28.35, 2)
    expect(options[3].grams).toBe(13.8)
  })

  it('collapses to the serving alone when the gram basis is unknown', () => {
    // Without a mass we cannot convert anything, so the picker must degrade to
    // the old plain-multiplier behaviour rather than invent units.
    const options = buildUnitOptions({ serving_size: '1 bowl', serving_size_grams: 0 })
    expect(options).toHaveLength(1)
    expect(options[0].id).toBe(SERVING_UNIT_ID)
    expect(options[0].label).toBe('1 bowl')
  })

  it('skips portions with no usable gram weight and duplicate labels', () => {
    const options = buildUnitOptions({
      serving_size: 'per 100g',
      serving_size_grams: 100,
      portions: [{ label: '1 tbsp', grams: 13.8 }, { label: '1 tbsp', grams: 13.8 }, { label: 'a dollop', grams: 0 }],
    })
    expect(options.filter(o => o.id.startsWith('portion:'))).toHaveLength(1)
  })

  it('falls back to a readable serving label when none is given', () => {
    expect(buildUnitOptions({ serving_size: '', serving_size_grams: 0 })[0].label).toBe('1 serving')
  })
})

describe('amountToServings', () => {
  const options = buildUnitOptions(mayo)

  it('converts a household measure against the gram basis', () => {
    // 1 tbsp of mayo is 13.8 g against a 100 g basis — the case a 0.5-step
    // servings stepper could not express at all.
    const tbsp = findUnit(options, 'portion:1 tbsp')
    expect(amountToServings(1, tbsp, 100)).toBeCloseTo(0.138, 4)
    expect(amountToServings(2, tbsp, 100)).toBeCloseTo(0.276, 4)
  })

  it('converts raw grams and ounces', () => {
    expect(amountToServings(30, findUnit(options, 'g'), 100)).toBeCloseTo(0.3, 4)
    expect(amountToServings(1, findUnit(options, 'oz'), 100)).toBeCloseTo(0.2835, 3)
  })

  it('treats the amount as the multiplier when there is no gram basis', () => {
    const serving = buildUnitOptions({ serving_size: '1 bowl', serving_size_grams: 0 })[0]
    expect(amountToServings(2.5, serving, 0)).toBe(2.5)
  })

  it('returns 0 for empty or invalid amounts', () => {
    const tbsp = findUnit(options, 'portion:1 tbsp')
    expect(amountToServings(0, tbsp, 100)).toBe(0)
    expect(amountToServings(NaN, tbsp, 100)).toBe(0)
  })
})

describe('amountToGrams', () => {
  it('multiplies out the chosen unit', () => {
    const tbsp = findUnit(buildUnitOptions(mayo), 'portion:1 tbsp')
    expect(amountToGrams(2, tbsp)).toBeCloseTo(27.6, 4)
  })

  it('is 0 when the unit has no mass', () => {
    const serving = buildUnitOptions({ serving_size: '1 bowl', serving_size_grams: 0 })[0]
    expect(amountToGrams(2, serving)).toBe(0)
  })
})

describe('formatUnitHint', () => {
  const options = buildUnitOptions(mayo)

  it('spells out a household measure in grams', () => {
    expect(formatUnitHint(findUnit(options, 'portion:1 tbsp'))).toBe('1 tbsp = 13.8 g')
  })

  it('says nothing for grams themselves', () => {
    expect(formatUnitHint(findUnit(options, 'g'))).toBe('')
  })

  it('says nothing when the mass is unknown', () => {
    expect(formatUnitHint(buildUnitOptions({ serving_size: '1 bowl', serving_size_grams: 0 })[0])).toBe('')
  })
})

describe('formatServingLabel', () => {
  const options = buildUnitOptions(mayo)

  it('records the household measure with its mass', () => {
    expect(formatServingLabel(1, findUnit(options, 'portion:1 tbsp'))).toBe('1 × 1 tbsp (14 g)')
  })

  it('records raw mass amounts plainly', () => {
    expect(formatServingLabel(30, findUnit(options, 'g'))).toBe('30 g')
  })

  it('keeps the food\'s own serving label as-is', () => {
    expect(formatServingLabel(2, findUnit(options, SERVING_UNIT_ID))).toBe('per 100g')
  })
})

describe('matchUnitForLabel', () => {
  const options = buildUnitOptions(mayo)

  it('reopens an entry on the unit it was logged with', () => {
    expect(matchUnitForLabel(options, '1 × 1 tbsp (14 g)').id).toBe('portion:1 tbsp')
  })

  it('falls back to the serving when the label matches nothing', () => {
    expect(matchUnitForLabel(options, 'per 100g').id).toBe(SERVING_UNIT_ID)
    expect(matchUnitForLabel(options, undefined).id).toBe(SERVING_UNIT_ID)
  })
})
