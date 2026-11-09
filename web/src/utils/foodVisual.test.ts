import { describe, it, expect } from 'vitest'
import { foodEmoji, dominantMacro, mealForNow } from './foodVisual'

describe('foodEmoji', () => {
  it('matches specific words before generic ones', () => {
    expect(foodEmoji('Peanut butter toast')).toBe('🥜')
    expect(foodEmoji('Sweet potato fries')).toBe('🍠')
    expect(foodEmoji('Pineapple chunks')).toBe('🍍')
    expect(foodEmoji('Watermelon')).toBe('🍉')
    expect(foodEmoji('Popcorn')).toBe('🍿')
  })
  it('does not trip on substrings', () => {
    expect(foodEmoji('Goat cheese')).toBe('🧀')
    expect(foodEmoji('Sparkling water')).toBe('💧')
  })
  it('pictures a composite meal by its headline food', () => {
    expect(foodEmoji('Chicken breast with rice and broccoli')).toBe('🍗')
    expect(foodEmoji('Greek yogurt and protein shake')).toBe('🥛')
    expect(foodEmoji('Lean ground beef with pasta')).toBe('🥩')
  })
  it('falls back to a plate', () => {
    expect(foodEmoji('Mystery item')).toBe('🍽️')
  })
})

describe('dominantMacro', () => {
  it('weights fat at 9 kcal/g', () => {
    expect(dominantMacro({ protein: 10, carbs: 10, fat: 10 })).toBe('fat')
    expect(dominantMacro({ protein: 40, carbs: 10, fat: 5 })).toBe('protein')
  })
  it('is null when there are no macros', () => {
    expect(dominantMacro({})).toBeNull()
  })
})

describe('mealForNow', () => {
  const at = (h: number) => new Date(2026, 0, 1, h)
  it('maps the clock to a meal', () => {
    expect(mealForNow(at(7))).toBe('breakfast')
    expect(mealForNow(at(12))).toBe('lunch')
    expect(mealForNow(at(16))).toBe('snacks')
    expect(mealForNow(at(19))).toBe('dinner')
    expect(mealForNow(at(22))).toBe('snacks')
  })
})
