import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MealRecommendations from './MealRecommendations'
import type { MealRecommendation } from '../types'

vi.mock('../services/api', () => ({
  foodAPI: { recommend: vi.fn(), log: vi.fn() },
}))

import { foodAPI } from '../services/api'

const RECS: MealRecommendation[] = [
  {
    title: 'Grilled chicken bowl',
    description: 'High protein to close your remaining protein gap.',
    items: [
      { name: 'Grilled chicken breast', quantity: '6 oz', calories: 280, protein: 52, carbs: 0, fat: 6, fiber: 0, sugar: 0, sodium: 120, cholesterol: 145, serving_size: '6 oz' },
      { name: 'Brown rice', quantity: '1 cup', calories: 220, protein: 5, carbs: 45, fat: 2, fiber: 3, sugar: 0, sodium: 10, cholesterol: 0, serving_size: '1 cup' },
    ],
  },
  {
    title: 'Tuna salad wrap',
    description: 'Light on carbs, fits your remaining calories.',
    items: [
      { name: 'Tuna salad wrap', quantity: '1 wrap', calories: 400, protein: 30, carbs: 35, fat: 15, fiber: 4, sugar: 3, sodium: 600, cholesterol: 40, serving_size: '1 wrap' },
    ],
  },
]

const renderOverlay = (props: Partial<React.ComponentProps<typeof MealRecommendations>> = {}) =>
  render(
    <MealRecommendations
      meal="lunch"
      mealLabel="Lunch"
      date="2026-07-15"
      onLogged={() => {}}
      onClose={() => {}}
      {...props}
    />,
  )

describe('MealRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches on mount and renders recommendation cards with aggregate macros', async () => {
    vi.mocked(foodAPI.recommend).mockResolvedValue({ recommendations: RECS })

    renderOverlay()

    expect(foodAPI.recommend).toHaveBeenCalledWith('lunch', '2026-07-15')
    await waitFor(() => expect(screen.getByText('Grilled chicken bowl')).toBeTruthy())
    // Appears twice: card title and its single item's name.
    expect(screen.getAllByText('Tuna salad wrap').length).toBeGreaterThan(0)
    // Aggregate for the first card: 280 + 220 = 500 kcal, 52 + 5 = 57g protein.
    expect(screen.getByText('500 kcal')).toBeTruthy()
    expect(screen.getByText('57g P')).toBeTruthy()
  })

  it('logs every item of the chosen recommendation with source ai, then calls onLogged', async () => {
    vi.mocked(foodAPI.recommend).mockResolvedValue({ recommendations: RECS })
    vi.mocked(foodAPI.log).mockResolvedValue({} as any)
    const onLogged = vi.fn()

    renderOverlay({ onLogged })
    await waitFor(() => expect(screen.getByText('Grilled chicken bowl')).toBeTruthy())

    fireEvent.click(screen.getAllByText('Log this meal')[0])

    await waitFor(() => expect(onLogged).toHaveBeenCalled())
    expect(foodAPI.log).toHaveBeenCalledTimes(2)
    expect(foodAPI.log).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Grilled chicken breast',
      meal: 'lunch',
      calories: 280,
      source: 'ai',
      servings: 1,
    }))
  })

  it('surfaces the server message on a 503 and offers a retry', async () => {
    vi.mocked(foodAPI.recommend)
      .mockRejectedValueOnce({ response: { status: 503, data: { error: 'meal recommendations are not configured on this server' } } })
      .mockResolvedValueOnce({ recommendations: RECS })

    renderOverlay()

    await waitFor(() => expect(screen.getByText(/not configured on this server/i)).toBeTruthy())
    fireEvent.click(screen.getByText(/retry/i))
    await waitFor(() => expect(screen.getByText('Grilled chicken bowl')).toBeTruthy())
    expect(foodAPI.recommend).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape', async () => {
    vi.mocked(foodAPI.recommend).mockResolvedValue({ recommendations: RECS })
    const onClose = vi.fn()

    renderOverlay({ onClose })
    await waitFor(() => expect(screen.getByText('Grilled chicken bowl')).toBeTruthy())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
