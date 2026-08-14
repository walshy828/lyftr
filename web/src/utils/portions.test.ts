import { describe, it, expect } from 'vitest'
import {
  buildUnitOptions, findUnit, amountToServings, amountToGrams, portionBasis,
  formatUnitHint, formatServingLabel, matchUnitForLabel, SERVING_UNIT_ID,
} from './portions'

const mayo = {
  serving_size: 'per 100g',
  serving_size_grams: 100,
  portions: [{ label: '1 tbsp', grams: 13.8, ml: 15 }, { label: '1 cup', grams: 220, ml: 240 }],
}

/** A drink: the panel states a volume and no mass anywhere. */
const juice = {
  serving_size: '240 ml',
  serving_size_grams: 0,
  serving_size_ml: 240,
}

/** A dry good with a mass basis and no published density. */
const flour = {
  serving_size: '30 g',
  serving_size_grams: 30,
}

describe('buildUnitOptions', () => {
  it('offers serving, mass units, the volume ladder, and every published portion', () => {
    const options = buildUnitOptions(mayo)
    expect(options.map(o => o.id)).toEqual([
      SERVING_UNIT_ID, 'g', 'oz', 'tsp', 'tbsp', 'floz', 'cup', 'ml',
      'portion:1 tbsp', 'portion:1 cup',
    ])
    expect(options[1].grams).toBe(1)
    expect(options[2].grams).toBeCloseTo(28.35, 2)
  })

  it('collapses to the serving alone when no basis is known', () => {
    // Without a mass or a volume we cannot convert anything, so the picker must
    // degrade to the old plain-multiplier behaviour rather than invent units.
    const options = buildUnitOptions({ serving_size: '1 bowl', serving_size_grams: 0 })
    expect(options).toHaveLength(1)
    expect(options[0].id).toBe(SERVING_UNIT_ID)
    expect(options[0].label).toBe('1 bowl')
  })

  it('uses a published density, so cups are exact rather than estimated', () => {
    // Mayo publishes 1 tbsp = 13.8 g against 15 ml — 0.92 g/ml. A cup is then
    // 240 × 0.92, not the 240 g water would give.
    const cup = findUnit(buildUnitOptions(mayo), 'cup')
    expect(cup.grams).toBeCloseTo(220.8, 1)
    expect(cup.estimated).toBe(false)
  })

  it('falls back to 1 g/ml and flags it when no density is published', () => {
    const cup = findUnit(buildUnitOptions(flour), 'cup')
    expect(cup.grams).toBe(240)
    expect(cup.estimated).toBe(true)
    // The mass units are still exact — they never crossed dimensions.
    expect(findUnit(buildUnitOptions(flour), 'oz').estimated).toBe(false)
  })

  it('offers exact volume units for a food measured in ml', () => {
    const options = buildUnitOptions(juice)
    const cup = findUnit(options, 'cup')
    // Cups divide into a millilitre serving exactly, so the macros are exact —
    // but nobody said what that cup weighs, so its gram figure is still ours.
    expect(cup.estimated).toBe(false)
    expect(cup.gramsEstimated).toBe(true)
    // Grams, conversely, weigh what they weigh; it's the route back to a
    // volume serving that's assumed.
    expect(findUnit(options, 'g').estimated).toBe(true)
    expect(findUnit(options, 'g').gramsEstimated).toBeFalsy()
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

describe('portionBasis', () => {
  it('fills in the missing dimension from the density', () => {
    // 100 g of mayo at 0.92 g/ml is ~109 ml.
    expect(portionBasis(mayo).ml).toBeCloseTo(108.7, 1)
    expect(portionBasis(mayo).estimated).toBe(false)
  })

  it('marks the derived half as estimated when the density was assumed', () => {
    const basis = portionBasis(flour)
    expect(basis.ml).toBe(30)
    expect(basis.estimated).toBe(true)
  })

  it('is empty for a food with no basis at all', () => {
    expect(portionBasis({ serving_size: '1 bowl', serving_size_grams: 0 })).toEqual({ grams: 0, ml: 0, estimated: false })
  })
})

describe('amountToServings', () => {
  const options = buildUnitOptions(mayo)
  const basis = portionBasis(mayo)

  it('converts a household measure against the gram basis', () => {
    // 1 tbsp of mayo is 13.8 g against a 100 g basis — the case a 0.5-step
    // servings stepper could not express at all.
    const tbsp = findUnit(options, 'portion:1 tbsp')
    expect(amountToServings(1, tbsp, basis)).toBeCloseTo(0.138, 3)
    expect(amountToServings(2, tbsp, basis)).toBeCloseTo(0.276, 3)
  })

  it('converts raw grams and ounces', () => {
    expect(amountToServings(30, findUnit(options, 'g'), basis)).toBeCloseTo(0.3, 4)
    expect(amountToServings(1, findUnit(options, 'oz'), basis)).toBeCloseTo(0.2835, 3)
  })

  it('converts half a cup of a drink in the volume dimension, exactly', () => {
    // 120 ml of a 240 ml serving — no density anywhere in the arithmetic.
    const cup = findUnit(buildUnitOptions(juice), 'cup')
    expect(amountToServings(0.5, cup, portionBasis(juice))).toBeCloseTo(0.5, 6)
  })

  it('converts a cup of a mass-based food through the density', () => {
    // A 30 g basis, a cup assumed at 240 g: 8 servings.
    const cup = findUnit(buildUnitOptions(flour), 'cup')
    expect(amountToServings(1, cup, portionBasis(flour))).toBeCloseTo(8, 4)
  })

  it('treats the amount as the multiplier when there is no basis', () => {
    const noBasis = { serving_size: '1 bowl', serving_size_grams: 0 }
    const serving = buildUnitOptions(noBasis)[0]
    expect(amountToServings(2.5, serving, portionBasis(noBasis))).toBe(2.5)
  })

  it('returns 0 for empty or invalid amounts', () => {
    const tbsp = findUnit(options, 'portion:1 tbsp')
    expect(amountToServings(0, tbsp, basis)).toBe(0)
    expect(amountToServings(NaN, tbsp, basis)).toBe(0)
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

  it('names an assumed density as an estimate', () => {
    expect(formatUnitHint(findUnit(buildUnitOptions(flour), 'cup'))).toBe('1 cup ≈ 240 g (estimated)')
  })

  it('states a published density plainly', () => {
    expect(formatUnitHint(findUnit(options, 'tbsp'))).toBe('1 tbsp = 13.8 g')
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

  it('records a volume amount with the mass it is known to weigh', () => {
    expect(formatServingLabel(0.5, findUnit(options, 'cup'))).toBe('0.5 cup (110 g)')
  })

  it('omits the mass when it was only estimated', () => {
    expect(formatServingLabel(0.5, findUnit(buildUnitOptions(flour), 'cup'))).toBe('0.5 cup')
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

  it('reopens a volume entry on its own unit', () => {
    expect(matchUnitForLabel(buildUnitOptions(juice), '0.5 cup').id).toBe('cup')
    expect(matchUnitForLabel(buildUnitOptions(juice), '8 fl oz').id).toBe('floz')
  })

  it('falls back to the serving when the label matches nothing', () => {
    expect(matchUnitForLabel(options, 'per 100g').id).toBe(SERVING_UNIT_ID)
    expect(matchUnitForLabel(options, undefined).id).toBe(SERVING_UNIT_ID)
  })
})
