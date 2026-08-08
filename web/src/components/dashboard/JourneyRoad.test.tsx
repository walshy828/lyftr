import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import JourneyRoad from './JourneyRoad'
import * as types from '../../types'

// Fixed "today" so which milestones count as past vs. future is deterministic.
const TODAY = new Date(2026, 7, 7) // Aug 7, 2026

const settings = { weight_unit: 'lbs' } as types.UserSettings

/** A plan timeline of weekly points starting Jun 1 2026, losing 1 lb/week. */
function timeline(weeks: number, start = 220, perWeek = 1): types.WeightPlanProjectionPoint[] {
  const base = new Date(2026, 5, 1)
  return Array.from({ length: weeks + 1 }, (_, w) => ({
    week: w,
    expected_weight: start - perWeek * w,
    expected_date: new Date(base.getTime() + w * 7 * 86400000).toISOString(),
  } as types.WeightPlanProjectionPoint))
}

function plan(points: types.WeightPlanProjectionPoint[], target = 190): types.CurrentNutritionGoal {
  return {
    goal: { target_weight: target } as types.NutritionGoal,
    projections: points,
    plan_timeline: points,
    actual_forecast: [],
    original_plan: [],
    journey_start: '2026-06-01',
  } as unknown as types.CurrentNutritionGoal
}

const log = (weight: number, date: Date): types.WeightLog =>
  ({ id: 1, weight, logged_at: date.toISOString() } as types.WeightLog)

function renderRoad(
  p: types.CurrentNutritionGoal,
  logs: types.WeightLog[] = [],
  s: types.UserSettings = settings,
) {
  const { container } = render(
    <MemoryRouter><JourneyRoad plan={p} weightLogs={logs} settings={s} /></MemoryRouter>,
  )
  return { container, text: container.textContent ?? '' }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
})
afterEach(() => vi.useRealTimers())

describe('JourneyRoad', () => {
  it('marks every US holiday inside the plan window', () => {
    // Jun 1 2026 + 30 weeks ≈ Dec 28 2026 — covers July 4th through Christmas.
    const { text } = renderRoad(plan(timeline(30)))
    for (const name of ['July 4th', 'Labor Day', 'Halloween', 'Thanksgiving', 'Christmas']) {
      expect(text).toContain(name)
    }
  })

  it('excludes holidays outside the plan window', () => {
    // Only 8 weeks: Jun 1 -> late July, so July 4th but nothing after it.
    const { text } = renderRoad(plan(timeline(8)))
    expect(text).toContain('July 4th')
    expect(text).not.toContain('Labor Day')
    expect(text).not.toContain('Thanksgiving')
  })

  it('shows the weight the plan projects for each milestone', () => {
    // July 4th falls between weeks 4 (216) and 5 (215) -> ~215.6 lbs.
    const { text } = renderRoad(plan(timeline(30)))
    expect(text).toMatch(/215\.\d lb/)
  })

  // The road has to end somewhere, and ending anywhere but the goal would
  // imply the journey continues past it.
  it('terminates the road with the goal', () => {
    const { text } = renderRoad(plan(timeline(20), 200))
    expect(text).toContain('Goal')
    expect(text).toContain('200 lb')
  })

  it('shows the actual weight logged near a milestone already passed', () => {
    // July 4th is in the past relative to the fake Aug 7 "today".
    const { text } = renderRoad(plan(timeline(30)), [log(214, new Date(2026, 6, 3))])
    expect(text).toContain('214 actual')
  })

  it('does not attribute an actual weight to a milestone still ahead', () => {
    const { text } = renderRoad(plan(timeline(30)), [log(214, new Date(2026, 6, 3))])
    expect(text.match(/actual/g) ?? []).toHaveLength(1)
  })

  // A weigh-in weeks away from a holiday says nothing about that holiday.
  it('ignores logs outside the tolerance around a milestone', () => {
    const { text } = renderRoad(plan(timeline(30)), [log(214, new Date(2026, 5, 10))])
    expect(text).not.toContain('actual')
  })

  it('describes the next milestone from where the user is today', () => {
    const { text } = renderRoad(plan(timeline(30)), [log(214, new Date(2026, 7, 6))])
    expect(text).toMatch(/Labor Day is \d+ weeks out/)
  })

  it('renders nothing without a usable timeline', () => {
    const { container } = renderRoad(plan([]))
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the timeline has a single point', () => {
    const { container } = renderRoad(plan(timeline(0)))
    expect(container.innerHTML).toBe('')
  })

  it('converts projected weights to the user preferred unit', () => {
    const { text } = renderRoad(plan(timeline(20), 200), [], { weight_unit: 'kg' } as types.UserSettings)
    expect(text).not.toContain('200 lb')
    expect(text).toMatch(/9\d(\.\d)? kg/) // 200 lbs ≈ 90.7 kg
  })
})
