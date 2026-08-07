import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Food from './Food'

vi.mock('../services/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: new Blob() }) },
  foodAPI: {
    list: vi.fn().mockResolvedValue([]),
    stats: vi.fn(),
    history: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    saveToMyFoods: vi.fn(),
  },
  userAPI: {
    getSettings: vi.fn(),
  },
}))

import { foodAPI, userAPI } from '../services/api'

const ENTRY = {
  id: 42,
  user_id: 1,
  name: 'Overnight oats',
  brand: 'Quaker',
  meal: 'breakfast' as const,
  calories: 300, protein: 24, carbs: 40, fat: 8,
  fiber: 6, sugar: 4, sodium: 100, cholesterol: 0,
  servings: 2,
  serving_size: '1 cup',
  serving_size_grams: 30,
  logged_at: '2026-01-01T12:00:00Z',
  created_at: '2026-01-01T12:00:00Z',
}

// recharts measures its container; jsdom reports 0×0, which is fine — the charts
// simply render empty and the meal list under test is unaffected.
function renderFood() {
  return render(
    <MemoryRouter initialEntries={['/food']}>
      <Food />
    </MemoryRouter>,
  )
}

// The row has to be on screen before its buttons are wired up — querying the
// button alone can resolve against the pre-load render.
async function findSaveButton() {
  await screen.findByText('Overnight oats')
  return screen.findByLabelText(/save overnight oats to my foods/i)
}

describe('Food — save a logged entry to My Foods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(foodAPI.list as any).mockResolvedValue([ENTRY])
    ;(foodAPI.stats as any).mockResolvedValue({
      date: '2026-01-01', total_calories: 300, total_protein: 24, total_carbs: 40,
      total_fat: 8, total_fiber: 6, total_sodium: 100, total_cholesterol: 0, workout_count: 0,
    })
    ;(foodAPI.history as any).mockResolvedValue([])
    ;(userAPI.getSettings as any).mockResolvedValue({
      user_id: 1, weight_unit: 'lbs',
      calorie_target: 2000, protein_target: 150, carb_target: 250, fat_target: 65,
      cholesterol_target: 300, sodium_target: 2300,
      food_allergies: '', food_dislikes: '', food_likes: '',
    })
  })

  it('saves an entry from any day and confirms it', async () => {
    ;(foodAPI.saveToMyFoods as any).mockResolvedValue({ id: 7, name: 'Overnight oats' })
    renderFood()

    fireEvent.click(await findSaveButton())

    await waitFor(() => expect(foodAPI.saveToMyFoods).toHaveBeenCalledWith(42, false))
    expect(await screen.findByText(/saved overnight oats to my foods/i)).toBeTruthy()
  })

  it('asks before duplicating a food that is already saved, then updates it on confirm', async () => {
    ;(foodAPI.saveToMyFoods as any).mockRejectedValueOnce({
      response: { status: 409, data: { error: 'already saved', data: { id: 7, name: 'Overnight oats' } } },
    })
    renderFood()

    fireEvent.click(await findSaveButton())

    // No second copy is created behind the user's back — they're asked first.
    expect(await screen.findByText(/is already in\s+My Foods/i)).toBeTruthy()
    expect(foodAPI.saveToMyFoods).toHaveBeenCalledTimes(1)

    ;(foodAPI.saveToMyFoods as any).mockResolvedValueOnce({ id: 7, name: 'Overnight oats' })
    fireEvent.click(screen.getByText('Update'))

    await waitFor(() => expect(foodAPI.saveToMyFoods).toHaveBeenLastCalledWith(42, true))
    expect(await screen.findByText(/updated overnight oats in my foods/i)).toBeTruthy()
  })

  it('leaves the existing saved food alone when the duplicate prompt is dismissed', async () => {
    ;(foodAPI.saveToMyFoods as any).mockRejectedValueOnce({
      response: { status: 409, data: { error: 'already saved', data: { id: 7, name: 'Overnight oats' } } },
    })
    renderFood()

    fireEvent.click(await findSaveButton())
    fireEvent.click(await screen.findByText('Keep'))

    await waitFor(() => expect(screen.queryByText(/is already in\s+My Foods/i)).toBeNull())
    expect(foodAPI.saveToMyFoods).toHaveBeenCalledTimes(1)
  })
})
