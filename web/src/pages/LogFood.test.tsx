import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LogFood from './LogFood'

vi.mock('../services/api', () => ({
  foodAPI: {
    list: vi.fn().mockResolvedValue([]),
    log: vi.fn().mockResolvedValue({}),
    get: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([]),
    barcode: vi.fn(),
    analyzeLabel: vi.fn(),
  },
  savedFoodsAPI: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
  },
}))

import { foodAPI } from '../services/api'

function renderLogFood(initialPath = '/food/log?meal=breakfast&date=2026-01-01') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/food/log" element={<LogFood />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LogFood manual entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(foodAPI.list as any).mockResolvedValue([])
    ;(foodAPI.log as any).mockResolvedValue({})
  })

  it('lets a user type a manual entry with real macro values and saves the servings-multiplied totals', async () => {
    renderLogFood()

    // Search phase: type a query with no results, then "Enter ... manually"
    const input = await screen.findByPlaceholderText('Search food…')
    fireEvent.change(input, { target: { value: 'Homemade Chili' } })

    await waitFor(() => expect(screen.getByText(/enter "homemade chili" manually/i)).toBeTruthy())
    fireEvent.click(screen.getByText(/enter "homemade chili" manually/i))

    // Detail phase: name field is pre-filled from the query, macros start at 0
    const nameInput = await screen.findByPlaceholderText('Food name')
    expect((nameInput as HTMLInputElement).value).toBe('Homemade Chili')

    const calorieInput = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(calorieInput, { target: { value: '400' } })

    // Bump servings to 2 — the calorie input shows the total, so editing it
    // after the bump should still reflect back into the per-serving base.
    const servingsInputs = screen.getAllByRole('spinbutton')
    const servingsInput = servingsInputs[servingsInputs.length - 1] // last spinbutton is the Servings stepper
    fireEvent.change(servingsInput, { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.name).toBe('Homemade Chili')
    expect(payload.servings).toBe(2)
    expect(payload.source).toBe('manual')
    // 400 kcal typed at servings=1, then servings bumped to 2 → total should double
    expect(payload.calories).toBe(800)
  })
})
