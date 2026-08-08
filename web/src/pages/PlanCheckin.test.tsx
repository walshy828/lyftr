import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as types from '../types'

const checkin = vi.fn()
const runCheckin = vi.fn()

vi.mock('../services/api', () => ({
  weightPlanAPI: {
    checkin: (...a: unknown[]) => checkin(...a),
    runCheckin: (...a: unknown[]) => runCheckin(...a),
  },
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
}))

import PlanCheckin from './PlanCheckin'

const facts: types.PlanCheckinFacts = {
  generated_at: '2026-08-07T00:00:00Z',
  weeks_into_plan: 10,
  plan_start: '2026-06-01T00:00:00Z',
  plan_end: '2026-12-01T00:00:00Z',
  journey_start: '2026-06-01T00:00:00Z',
  start_weight: 240,
  current_weight: 222,
  target_weight: 190,
  expected_weight_now: 220,
  variance_lbs: 2,
  behind_plan: true,
  lost_lbs: 18,
  pct_body_weight_lost: 7.5,
  overall_lbs_per_week: 1.8,
  recent_lbs_per_week: 0.05,
  recent_window_days: 28,
  plan_lbs_per_week: 2,
  pattern: 'stalled',
  projected_goal_date: '2027-03-01T00:00:00Z',
  days_vs_plan_goal_date: 90,
  adherence: [
    { days: 7, food_logged_days: 3, workout_days: 1, avg_calories: 2400, avg_protein: 120, calorie_target: 1800, protein_target: 160 },
    { days: 28, food_logged_days: 20, workout_days: 8, avg_calories: 1900, avg_protein: 150, calorie_target: 1800, protein_target: 160 },
    { days: 90, food_logged_days: 70, workout_days: 30, avg_calories: 1850, avg_protein: 155, calorie_target: 1800, protein_target: 160 },
  ],
  weekly_variance: [],
  basis: null,
  bmi: { bmi: 30, category: 'obese' } as types.BMIInfo,
  profile: {} as types.UserProfile,
}

const report: types.PlanCheckinReport = {
  headline: 'On plan overall, but the last three weeks have stalled',
  overall_assessment: 'Your whole-journey pace is strong.',
  recent_assessment: 'The last four weeks have flattened out.',
  benchmarks: [{
    label: 'Body weight lost at 10 weeks',
    user_value: '7.5%',
    typical_range: '4-8%',
    verdict: 'ahead',
    context: 'Most structured programs land in this band by ten weeks.',
  }],
  whats_working: [{ title: 'Protein is on target', detail: 'You are averaging 155 g.' }],
  whats_slipping: [{ title: 'Weekday logging dropped', detail: 'Only 3 of the last 7 days.' }],
  recommendations: [{ title: 'Log every day this week', detail: 'Even rough estimates.', why_it_works: 'Self-monitoring predicts outcomes.', effort: 'easy' }],
  what_works_generally: [{ title: 'Weigh in daily', detail: 'Daily data smooths the noise.' }],
  outlook: 'Hold the pace and you land in spring.',
}

const mk = (over: Partial<types.PlanCheckin> = {}): types.PlanCheckin => ({
  id: 1, user_id: 1, goal_id: 1,
  created_at: new Date().toISOString(),
  facts, report, ...over,
})

const renderPage = () => render(<MemoryRouter><PlanCheckin /></MemoryRouter>)

beforeEach(() => {
  checkin.mockReset()
  runCheckin.mockReset()
})

describe('PlanCheckin', () => {
  // Generating costs a slow AI call, so loading the page must only ever read
  // the last stored run.
  it('does not generate a report on mount', async () => {
    checkin.mockResolvedValue(null)
    renderPage()
    await waitFor(() => expect(checkin).toHaveBeenCalled())
    expect(runCheckin).not.toHaveBeenCalled()
  })

  it('offers to run one when none is stored', async () => {
    checkin.mockResolvedValue(null)
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toContain('No check-in yet'))
  })

  it('generates only when the user asks', async () => {
    checkin.mockResolvedValue(null)
    runCheckin.mockResolvedValue(mk())
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toContain('No check-in yet'))

    fireEvent.click(screen.getAllByRole('button', { name: /run check-in/i })[0])
    await waitFor(() => expect(runCheckin).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(container.textContent).toContain(report.headline))
  })

  it('renders the report sections', async () => {
    checkin.mockResolvedValue(mk())
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toContain(report.headline))
    const text = container.textContent ?? ''
    expect(text).toContain('Your whole-journey pace is strong.')
    expect(text).toContain('The last four weeks have flattened out.')
    expect(text).toContain('Body weight lost at 10 weeks')
    // No hardcoded "typically" — the model's range supplies its own hedge.
    expect(text).toContain('vs. 4-8%')
    expect(text).toContain('Protein is on target')
    expect(text).toContain('Weekday logging dropped')
    expect(text).toContain('Log every day this week')
    expect(text).toContain('Why it works: Self-monitoring predicts outcomes.')
    expect(text).toContain('Weigh in daily')
    expect(text).toContain(report.outlook)
  })

  // The whole point of the feature: overall and recent are stated separately,
  // so "on plan overall but stalled recently" stays visible.
  it('shows the overall and recent paces side by side', async () => {
    checkin.mockResolvedValue(mk())
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toContain('Whole journey'))
    const text = container.textContent ?? ''
    expect(text).toContain('Last 28 days')
    expect(text).toContain('1.8')
    expect(text).toContain('Plan asks for 2 lb/week')
  })

  it('maps the computed pattern to a verdict label', async () => {
    checkin.mockResolvedValue(mk())
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toContain('Stalled'))
  })

  // A server with no AI provider stores facts and a null report; every number
  // must still render, with the missing narrative explained rather than blank.
  it('renders every fact with no AI narrative', async () => {
    checkin.mockResolvedValue(mk({ report: null }))
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toContain('Stalled'))
    const text = container.textContent ?? ''
    expect(text).toContain('needs an AI provider configured')
    // The deterministic blurb stands in for the AI headline.
    expect(text).toContain("The scale hasn't moved meaningfully")
    // Facts-derived sections are all still present.
    expect(text).toContain('Whole journey')
    expect(text).toContain('Consistency over time')
    expect(text).toContain('3/7')
    expect(text).toContain('Last 90 days')
  })

  it('prompts to build a plan when there is none', async () => {
    checkin.mockResolvedValue(null)
    runCheckin.mockRejectedValue({ response: { status: 404 } })
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toContain('No check-in yet'))

    fireEvent.click(screen.getAllByRole('button', { name: /run check-in/i })[0])
    await waitFor(() => expect(container.textContent).toContain('No weight-loss plan yet'))
  })

  it('surfaces a generation failure without losing the page', async () => {
    checkin.mockResolvedValue(mk())
    runCheckin.mockRejectedValue(new Error('boom'))
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toContain(report.headline))

    fireEvent.click(screen.getByRole('button', { name: /run again/i }))
    await waitFor(() => expect(container.textContent).toContain('Could not run your check-in'))
    // The previously stored report is still on screen.
    expect(container.textContent).toContain(report.headline)
  })

  it('flags a stale report', async () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString()
    checkin.mockResolvedValue(mk({ created_at: old }))
    const { container } = renderPage()
    await waitFor(() => expect(container.textContent).toMatch(/This check-in is \d+ days old/))
  })
})
