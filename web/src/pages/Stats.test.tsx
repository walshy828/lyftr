import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import Stats from './Stats'

// All panels are mocked: this test is about tab routing, not panel internals,
// and mocking them lets us assert that inactive panels never mount.
vi.mock('../components/training/TrainingPanel', () => ({
  default: () => <div data-testid="training-panel">training</div>,
}))
vi.mock('../components/health/WeightPanel', () => ({
  default: () => <div data-testid="weight-panel">weight</div>,
}))
vi.mock('../components/health/BloodPressurePanel', () => ({
  default: () => <div data-testid="bp-panel">bp</div>,
}))
vi.mock('../components/health/CardioPanel', () => ({
  default: () => <div data-testid="cardio-panel">cardio</div>,
}))
vi.mock('../components/health/SleepPanel', () => ({
  default: () => <div data-testid="sleep-panel">sleep</div>,
}))
vi.mock('../components/health/HeartPanel', () => ({
  default: () => <div data-testid="heart-panel">heart</div>,
}))
vi.mock('../components/health/ActivityPanel', () => ({
  default: () => <div data-testid="activity-panel">activity</div>,
}))
vi.mock('../components/health/NutritionPanel', () => ({
  default: () => <div data-testid="nutrition-panel">nutrition</div>,
}))

function LocationSpy() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/stats" element={<><Stats /><LocationSpy /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Stats hub', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to the training tab', async () => {
    renderAt('/stats')
    expect(await screen.findByTestId('training-panel')).toBeTruthy()
    expect(screen.queryByTestId('sleep-panel')).toBeNull()
  })

  // The regression this design is most exposed to: a fresh page load on the
  // deep link, not a click.
  it('honours ?tab=sleep on a cold load', async () => {
    renderAt('/stats?tab=sleep')
    expect(await screen.findByTestId('sleep-panel')).toBeTruthy()
    expect(screen.queryByTestId('training-panel')).toBeNull()
  })

  it('falls back to training for an unknown tab value', async () => {
    renderAt('/stats?tab=garbage')
    expect(await screen.findByTestId('training-panel')).toBeTruthy()
  })

  it('switches panels and writes the tab into the query string', async () => {
    renderAt('/stats')
    await screen.findByTestId('training-panel')

    fireEvent.click(screen.getByRole('button', { name: 'Blood Pressure' }))

    expect(await screen.findByTestId('bp-panel')).toBeTruthy()
    // Only the active panel is mounted, so the inactive ones can't fire fetches.
    expect(screen.queryByTestId('training-panel')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/stats?tab=bp'),
    )
  })
})
