import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import Health from './Health'

// Both panels are mocked: this test is about tab routing, not panel internals,
// and mocking them lets us assert that the inactive panel never mounts.
vi.mock('../components/health/WeightPanel', () => ({
  default: () => <div data-testid="weight-panel">weight</div>,
}))
vi.mock('../components/health/BloodPressurePanel', () => ({
  default: () => <div data-testid="bp-panel">bp</div>,
}))

function LocationSpy() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/health" element={<><Health /><LocationSpy /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Health hub', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to the weight tab', async () => {
    renderAt('/health')
    expect(await screen.findByTestId('weight-panel')).toBeTruthy()
    expect(screen.queryByTestId('bp-panel')).toBeNull()
  })

  // The regression this design is most exposed to: a fresh page load on the
  // deep link, not a click.
  it('honours ?tab=bp on a cold load', async () => {
    renderAt('/health?tab=bp')
    expect(await screen.findByTestId('bp-panel')).toBeTruthy()
    expect(screen.queryByTestId('weight-panel')).toBeNull()
  })

  it('falls back to weight for an unknown tab value', async () => {
    renderAt('/health?tab=garbage')
    expect(await screen.findByTestId('weight-panel')).toBeTruthy()
  })

  it('switches panels and writes the tab into the query string', async () => {
    renderAt('/health')
    await screen.findByTestId('weight-panel')

    fireEvent.click(screen.getByRole('button', { name: 'Blood Pressure' }))

    expect(await screen.findByTestId('bp-panel')).toBeTruthy()
    // Only the active panel is mounted, so the inactive one can't fire fetches.
    expect(screen.queryByTestId('weight-panel')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/health?tab=bp'),
    )
  })
})
