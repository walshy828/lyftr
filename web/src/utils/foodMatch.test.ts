import { describe, it, expect } from 'vitest'
import { normalizeFoodName, scoreFoodMatch, filterFoods } from './foodMatch'

describe('normalizeFoodName', () => {
  it('lowercases, collapses whitespace, and trims', () => {
    expect(normalizeFoodName('  Whole   MILK\t')).toBe('whole milk')
    expect(normalizeFoodName(undefined)).toBe('')
  })
})

describe('scoreFoodMatch', () => {
  it('ranks exact, prefix, and substring name matches in that order', () => {
    expect(scoreFoodMatch({ name: 'Mayonnaise' }, 'mayonnaise')).toBe(0)
    expect(scoreFoodMatch({ name: 'Mayonnaise, light' }, 'mayonnaise')).toBe(1)
    expect(scoreFoodMatch({ name: 'Light Mayonnaise' }, 'mayonnaise')).toBe(2)
  })

  it('matches on brand, ranked below any name match', () => {
    expect(scoreFoodMatch({ name: 'Greek Yogurt', brand: 'Chobani' }, 'chobani')).toBe(3)
  })

  it('requires every query token to appear somewhere', () => {
    // "peanut butter" must not match a plain "butter".
    expect(scoreFoodMatch({ name: 'Butter' }, 'peanut butter')).toBe(-1)
    expect(scoreFoodMatch({ name: 'Peanut Butter' }, 'peanut butter')).toBe(0)
  })

  it('matches everything on an empty query', () => {
    expect(scoreFoodMatch({ name: 'Anything' }, '   ')).toBe(0)
  })
})

describe('filterFoods', () => {
  const foods = [
    { name: 'Light Mayonnaise' },
    { name: 'Mayonnaise' },
    { name: 'Mustard' },
    { name: 'Mayonnaise, olive oil' },
  ]

  it('drops non-matches and orders closer matches first', () => {
    expect(filterFoods(foods, 'mayonnaise').map(f => f.name)).toEqual([
      'Mayonnaise', 'Mayonnaise, olive oil', 'Light Mayonnaise',
    ])
  })

  it('returns the list untouched for an empty query', () => {
    expect(filterFoods(foods, '')).toEqual(foods)
  })
})
