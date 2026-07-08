import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NutritionLabelCamera from './NutritionLabelCamera'

vi.mock('../services/api', () => ({
  foodAPI: { analyzeLabel: vi.fn() },
}))

import { foodAPI } from '../services/api'

describe('NutritionLabelCamera', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the camera-unavailable fallback and lets the user bail out to manual entry', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })
    const onClose = vi.fn()

    render(<NutritionLabelCamera onResult={() => {}} onClose={onClose} />)

    await waitFor(() => expect(screen.getByText(/camera unavailable/i)).toBeTruthy())
    expect(screen.getByText(/permission denied/i)).toBeTruthy()

    fireEvent.click(screen.getByText(/enter manually instead/i))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('no camera'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })
    const onClose = vi.fn()

    render(<NutritionLabelCamera onResult={() => {}} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText(/camera unavailable/i)).toBeTruthy())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('never calls the analyze API on its own — only a user capture triggers it', async () => {
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    render(<NutritionLabelCamera onResult={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    expect(foodAPI.analyzeLabel).not.toHaveBeenCalled()
  })
})
