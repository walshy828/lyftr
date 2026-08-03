import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PlanEnergyNarrative from './PlanEnergyNarrative'
import * as types from '../types'

const level = (
  key: types.ActivityEnergyLevel['key'],
  label: string,
  maintenance: number,
  isProfile = false,
): types.ActivityEnergyLevel => ({
  key,
  label,
  description: '',
  multiplier: 1,
  maintenance_calories: maintenance,
  intake_low_calories: maintenance - 1000,
  intake_high_calories: maintenance - 600,
  floor_limited: false,
  plan_deficit_calories: 0,
  plan_lbs_per_week: 0,
  is_profile_level: isProfile,
})

const basis: types.PlanEnergyBasis = {
  sex: 'male',
  age: 47,
  height_inches: 61,
  current_weight_lbs: 225,
  target_weight_lbs: 175,
  weight_to_lose_lbs: 50,
  bmi: 42.5,
  bmi_category: 'obese',
  activity_level: 'moderate',
  bmr: 1800,
  calorie_floor: 1500,
  levels: [
    level('sedentary', 'Sedentary', 2160),
    level('light', 'Light', 2475),
    level('moderate', 'Moderate', 2790, true),
    level('active', 'Heavy', 3105),
    level('very_active', 'Very heavy', 3420),
  ],
  maintenance_calories: 2790,
  calorie_target: 2290,
  plan_deficit_calories: 500,
  plan_lbs_per_week: 1,
  guidance: { low_lbs_per_week: 1, high_lbs_per_week: 2, note: '' },
  protein: { low_grams: 140, high_grams: 175, per_lb_low: 0.8, per_lb_high: 1, basis: 'goal weight', rationale: '', floor_grams: 105 },
  fat: { low_grams: 53, high_grams: 70, per_lb_low: 0.3, per_lb_high: 0.4, basis: 'goal weight', rationale: '', floor_grams: 53 },
}

describe('PlanEnergyNarrative', () => {
  it('states maintenance calories for light, moderate and heavy activity', () => {
    const { container } = render(<PlanEnergyNarrative basis={basis} weeks={25} weightUnit="lbs" />)
    const text = container.textContent!
    expect(text).toContain('47-year-old male')
    expect(text).toContain(`5' 1"`)
    expect(text).toContain('225 lb')
    expect(text).toContain('2,475 for light activity')
    expect(text).toContain('2,790 for moderate activity')
    expect(text).toContain('3,105 for heavy activity')
  })

  it('frames the goal as a deficit against the profile level’s maintenance', () => {
    const { container } = render(<PlanEnergyNarrative basis={basis} weeks={25} weightUnit="lbs" />)
    const text = container.textContent!
    expect(text).toContain('175 lb')
    expect(text).toContain('in approximately 25 weeks')
    expect(text).toContain('500 calorie deficit')
    expect(text).toContain('2,290 kcal/day')
    expect(text).toContain('1 lb/week') // 500 kcal/day * 7 / 3500
  })

  it('prefers an explicit calorie target over the basis’s own', () => {
    const { container } = render(<PlanEnergyNarrative basis={basis} calorieTarget={2000} weightUnit="lbs" />)
    const text = container.textContent!
    expect(text).toContain('790 calorie deficit') // 2790 - 2000
    expect(text).not.toContain('in approximately')
  })

  it('flags a target that leaves no deficit at all', () => {
    const { container } = render(<PlanEnergyNarrative basis={basis} calorieTarget={2900} weightUnit="lbs" />)
    expect(container.textContent).toContain('there’s no deficit here')
  })

  it('renders metric height and weights for kg users', () => {
    const { container } = render(<PlanEnergyNarrative basis={basis} weightUnit="kg" />)
    const text = container.textContent!
    expect(text).toContain('155 cm')
    expect(text).toContain('102.1 kg')
  })
})
