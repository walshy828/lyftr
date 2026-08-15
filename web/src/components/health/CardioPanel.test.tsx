import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CardioPanel from './CardioPanel'
import type * as types from '../../types'

// jsdom has no IntersectionObserver; useServerInfiniteList's sentinel effect
// only needs the constructor to exist and be inert here.
class FakeIntersectionObserver {
  observe() {}
  disconnect() {}
}
;(globalThis as any).IntersectionObserver = FakeIntersectionObserver

vi.mock('../../services/api', () => ({
  cardioAPI: {
    list: vi.fn(),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue({}),
  },
}))

import { cardioAPI } from '../../services/api'

const session: types.CardioSession = {
  id: 1,
  external_id: 'hc-1',
  activity_type: 'running',
  started_at: '2026-08-10T07:00:00Z',
  ended_at: '2026-08-10T07:30:00Z',
  duration_seconds: 1800,
  distance_meters: 5000,
  avg_heart_rate: 145,
  calories: 320,
  source: 'health_connect',
}

describe('CardioPanel', () => {
  it('shows an empty state when there are no sessions', async () => {
    vi.mocked(cardioAPI.list).mockResolvedValue([])
    render(<CardioPanel />)
    await waitFor(() => expect(screen.getByText(/no cardio sessions yet/i)).toBeTruthy())
  })

  it('renders imported sessions with their summary stats', async () => {
    vi.mocked(cardioAPI.list).mockResolvedValue([session])
    render(<CardioPanel />)
    await waitFor(() => expect(screen.getByText('Run')).toBeTruthy())
    expect(screen.getByText('30m')).toBeTruthy()
    expect(screen.getByText('5.00 km')).toBeTruthy()
    expect(screen.getByText('145 bpm')).toBeTruthy()
    expect(screen.getByText('320 cal')).toBeTruthy()
  })

  it('deletes a session and refreshes the list', async () => {
    vi.mocked(cardioAPI.list).mockResolvedValueOnce([session]).mockResolvedValueOnce([])
    render(<CardioPanel />)
    await waitFor(() => expect(screen.getByText('Run')).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Delete session'))

    await waitFor(() => expect(cardioAPI.delete).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByText(/no cardio sessions yet/i)).toBeTruthy())
  })
})
