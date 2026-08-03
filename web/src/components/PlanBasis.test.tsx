import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PlanBasis from './PlanBasis'
import * as types from '../types'

const basis: types.PlanEnergyBasis = {
  sex: 'male',
  age: 40,
  height_inches: 70,
  current_weight_lbs: 230,
  target_weight_lbs: 180,
  weight_to_lose_lbs: 50,
  bmi: 33,
  bmi_category: 'obese',
  activity_level: 'moderate',
  bmr: 1959,
  calorie_floor: 1500,
  levels: [
    { key: 'sedentary', label: 'Sedentary', description: 'Desk job', multiplier: 1.2, maintenance_calories: 2351, intake_low_calories: 1500, intake_high_calories: 1601, floor_limited: true, plan_deficit_calories: 451, plan_lbs_per_week: 0.9, is_profile_level: false },
    { key: 'light', label: 'Light', description: '1-3 days/week', multiplier: 1.375, maintenance_calories: 2693, intake_low_calories: 1693, intake_high_calories: 1943, floor_limited: false, plan_deficit_calories: 793, plan_lbs_per_week: 1.6, is_profile_level: false },
    { key: 'moderate', label: 'Moderate', description: '3-5 days/week', multiplier: 1.55, maintenance_calories: 3036, intake_low_calories: 2036, intake_high_calories: 2286, floor_limited: false, plan_deficit_calories: 1136, plan_lbs_per_week: 2.3, is_profile_level: true },
    { key: 'active', label: 'Heavy', description: '6-7 days/week', multiplier: 1.725, maintenance_calories: 3379, intake_low_calories: 2379, intake_high_calories: 2629, floor_limited: false, plan_deficit_calories: 1479, plan_lbs_per_week: 3, is_profile_level: false },
    { key: 'very_active', label: 'Very heavy', description: 'Physical job', multiplier: 1.9, maintenance_calories: 3722, intake_low_calories: 2722, intake_high_calories: 2972, floor_limited: false, plan_deficit_calories: 1822, plan_lbs_per_week: 3.6, is_profile_level: false },
  ],
  maintenance_calories: 3036,
  calorie_target: 1900,
  plan_deficit_calories: 1136,
  plan_lbs_per_week: 2.3,
  guidance: { low_lbs_per_week: 1.2, high_lbs_per_week: 2, note: 'About 1-2 lbs/week is safe at your BMI.' },
  protein: { low_grams: 144, high_grams: 180, per_lb_low: 0.8, per_lb_high: 1, basis: 'goal weight', rationale: 'Protects lean muscle.', floor_grams: 108 },
  fat: { low_grams: 54, high_grams: 72, per_lb_low: 0.3, per_lb_high: 0.4, basis: 'goal weight', rationale: 'Hormone production.', floor_grams: 54 },
}

const targets = { calories: 1900, protein: 180, carbs: 150, fat: 60 }

/** The profile-recount grid, scoped away from the narrative above it — both
 *  legitimately state the user's height and weight, so a bare getByText would
 *  match twice. */
const profileGrid = () =>
  within(screen.getByText('Your profile').closest('div')!.querySelector('.grid') as HTMLElement)

/** The activity-level table, likewise scoped away from the narrative's own
 *  maintenance tiles. */
const activityTable = (container: HTMLElement) =>
  within(container.querySelector('table') as HTMLElement)

describe('PlanBasis', () => {
  it('recounts the profile the plan was computed from', () => {
    render(<PlanBasis basis={basis} targets={targets} weightUnit="lbs" />)
    const grid = profileGrid()
    expect(grid.getByText('Male')).toBeTruthy()
    expect(grid.getByText(`5' 10"`)).toBeTruthy()
    expect(grid.getByText('230 lb')).toBeTruthy() // current weight
    expect(grid.getByText('180 lb')).toBeTruthy() // goal weight
    expect(grid.getByText('50 lb')).toBeTruthy() // to lose
    expect(grid.getByText('1,959 kcal')).toBeTruthy() // resting burn
  })

  it('shows maintenance and the recommended intake window for every activity level', () => {
    const { container } = render(<PlanBasis basis={basis} targets={targets} weightUnit="lbs" />)
    const table = activityTable(container)
    for (const l of basis.levels) {
      expect(table.getByText(l.label)).toBeTruthy()
      expect(table.getByText(l.maintenance_calories.toLocaleString())).toBeTruthy()
    }
    // The level that can't reach the pace band without going under the floor
    // is called out rather than silently clamped.
    expect(screen.getByText('floor-limited')).toBeTruthy()
  })

  it('states the deficit the draft calories represent at the user’s own level', () => {
    const { container } = render(<PlanBasis basis={basis} targets={targets} weightUnit="lbs" />)
    // 3036 maintenance - 1900 target = 1,136 kcal/day
    expect(container.textContent).toContain('1,136')
    expect(container.textContent).toContain('moderate')
  })

  it('follows edited targets rather than the AI’s originals', () => {
    const { container } = render(
      <PlanBasis basis={basis} targets={{ ...targets, calories: 2400 }} weightUnit="lbs" />,
    )
    expect(container.textContent).toContain('636') // 3036 - 2400
    expect(container.textContent).not.toContain('1,136')
  })

  it('flags a protein target that sits outside the recommended band', () => {
    render(<PlanBasis basis={basis} targets={targets} weightUnit="lbs" />)
    expect(screen.getByText('180 g · in range')).toBeTruthy()

    render(<PlanBasis basis={basis} targets={{ ...targets, protein: 90 }} weightUnit="lbs" />)
    expect(screen.getByText('90 g · outside range')).toBeTruthy()
  })

  it('offers reduced-protein options that hold calories constant', () => {
    render(<PlanBasis basis={basis} targets={targets} weightUnit="lbs" />)
    const row80 = screen.getByText('80%').closest('tr')!
    // 80% of 180g protein, with the freed calories moved into carbs and fat.
    expect(within(row80).getByText('144 g')).toBeTruthy()
    expect(within(row80).getByText('1,860')).toBeTruthy() // same calories as 100%
    const row100 = screen.getByText(/100%/).closest('tr')!
    expect(within(row100).getByText('1,860')).toBeTruthy()
  })

  it('warns when an option drops protein below the lean-mass floor', () => {
    render(<PlanBasis basis={basis} targets={targets} weightUnit="lbs" />)
    // 70% of 180g = 126g, still above the 108g floor — nothing flagged yet.
    expect(screen.queryByText(/below 108 g minimum/)).toBeNull()

    render(<PlanBasis basis={basis} targets={{ ...targets, protein: 140 }} weightUnit="lbs" />)
    // 70% of 140g = 98g, under the floor.
    expect(screen.getAllByText(/below 108 g minimum/).length).toBeGreaterThan(0)
  })

  it('renders height in centimetres for metric users', () => {
    render(<PlanBasis basis={basis} targets={targets} weightUnit="kg" />)
    const grid = profileGrid()
    expect(grid.getByText('178 cm')).toBeTruthy()
    expect(grid.getByText('104.3 kg')).toBeTruthy() // 230 lbs
  })
})

describe('PlanBasis deficit warnings', () => {
  it('flags a calorie target whose implied pace outruns the safe band', () => {
    // 3036 maintenance - 1400 = 1,636 kcal/day ≈ 3.3 lb/week, past the 2.0 cap.
    const { container } = render(
      <PlanBasis basis={basis} targets={{ ...targets, calories: 1400 }} weightUnit="lbs" />,
    )
    expect(container.textContent).toContain('faster than the pace recommended for your BMI')
    // 1,400 is also under the 1,500 kcal floor for this profile.
    expect(container.textContent).toContain('under the 1,500 kcal/day minimum')
  })

  it('says nothing when the target sits inside the safe band', () => {
    // 3036 - 2200 = 836 kcal/day ≈ 1.7 lb/week, inside the 1.2-2.0 band.
    const { container } = render(
      <PlanBasis basis={basis} targets={{ ...targets, calories: 2200 }} weightUnit="lbs" />,
    )
    expect(container.textContent).not.toContain('faster than the pace recommended')
    expect(container.textContent).not.toContain('minimum this app recommends')
  })
})
