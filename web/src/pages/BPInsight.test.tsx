import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BPInsight from './BPInsight'

vi.mock('../services/api', () => ({
  bloodPressureAPI: {
    insight: vi.fn(),
    runInsight: vi.fn(),
  },
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
}))

import { bloodPressureAPI } from '../services/api'

const facts = {
  generated_at: '2026-08-12T12:00:00Z',
  windows: [
    { days: 7, avg_systolic: 132, avg_diastolic: 84, category: 'stage1', readings: 10, sessions: 7, days_with_data: 7, max_systolic: 140, max_diastolic: 90, worst_category: 'stage2', sys_std_dev: 4 },
    { days: 30, avg_systolic: 134, avg_diastolic: 86, category: 'stage1', readings: 40, sessions: 28, days_with_data: 22, max_systolic: 150, max_diastolic: 95, worst_category: 'stage2', sys_std_dev: 6 },
    { days: 90, avg_systolic: 138, avg_diastolic: 88, category: 'stage1', readings: 100, sessions: 80, days_with_data: 60, max_systolic: 160, max_diastolic: 98, worst_category: 'stage2', sys_std_dev: 8 },
  ],
  daily: [],
  category: 'stage1',
  worst_category: 'stage2',
  trend_label: 'improving',
  sys_per_30d: -4.2,
  dia_per_30d: -1.8,
  nudges: [],
  weight: { current_lbs: 190, change_30d_lbs: -3, change_90d_lbs: -9, bmi_category: 'overweight', entries: 40 },
  training: { workout_days_30: 12, workout_days_90: 30 },
  nutrition: { avg_sodium_mg: 3100, sodium_target_mg: 2300, days_logged_30: 18 },
  bmi: 27.2,
} as any

const report = {
  headline: 'Your average is drifting down',
  where_you_stand: 'stand text',
  trend_reading: 'trend text',
  contributors: [
    { factor: 'Sodium intake', direction: 'hurting', evidence: '3100 mg vs a 2300 mg target', strength: 'moderate' },
  ],
  action_plan: [
    { title: 'Cut sodium', detail: 'detail', why_it_works: 'why', effort: 'moderate', horizon: 'this month' },
  ],
  measurement_tips: [{ title: 'Rest first', detail: 'five minutes seated' }],
  see_a_doctor: '',
  outlook: 'outlook text',
} as any

const stored = { id: 1, created_at: '2026-08-12T12:00:00Z', facts, report }

function renderPage() {
  render(<MemoryRouter><BPInsight /></MemoryRouter>)
}

describe('BPInsight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(bloodPressureAPI.insight).mockResolvedValue(null)
    vi.mocked(bloodPressureAPI.runInsight).mockResolvedValue(stored)
  })

  // The cardinal rule for AI pages here: opening one must not spend a call.
  it('reads on mount and never generates', async () => {
    renderPage()
    await waitFor(() => expect(bloodPressureAPI.insight).toHaveBeenCalledTimes(1))
    expect(bloodPressureAPI.runInsight).not.toHaveBeenCalled()
  })

  it('generates only when asked', async () => {
    renderPage()
    await screen.findByText(/Run insight/i)

    fireEvent.click(screen.getByRole('button', { name: /run insight/i }))

    await waitFor(() => expect(bloodPressureAPI.runInsight).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Your average is drifting down')).toBeTruthy()
    expect(screen.getByText('Sodium intake')).toBeTruthy()
    expect(screen.getByText('Cut sodium')).toBeTruthy()
  })

  it('renders every computed fact when no report was generated', async () => {
    vi.mocked(bloodPressureAPI.insight).mockResolvedValue({ ...stored, report: null } as any)
    renderPage()

    // The numbers are all local, so they must survive a provider-less server.
    expect(await screen.findByText('134/86')).toBeTruthy()
    expect(screen.getByText('22/30 days')).toBeTruthy()
    expect(screen.getByText('12 days')).toBeTruthy()
    expect(screen.getByText('3100 mg')).toBeTruthy()
    expect(screen.getByText(/needs an AI provider configured/i)).toBeTruthy()
  })

  it('surfaces the escalation notice in its own slot', async () => {
    vi.mocked(bloodPressureAPI.insight).mockResolvedValue({
      ...stored,
      report: { ...report, see_a_doctor: 'Worth discussing with a clinician.' },
    } as any)
    renderPage()

    const banner = await screen.findByTestId('bp-see-a-doctor')
    expect(banner.textContent).toContain('Worth discussing with a clinician.')
  })

  it('hides the escalation slot when nothing warrants it', async () => {
    vi.mocked(bloodPressureAPI.insight).mockResolvedValue(stored as any)
    renderPage()

    await screen.findByText('Your average is drifting down')
    expect(screen.queryByTestId('bp-see-a-doctor')).toBeNull()
  })
})
