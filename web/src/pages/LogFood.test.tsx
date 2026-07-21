import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LogFood from './LogFood'

vi.mock('../services/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: new Blob() }) },
  foodAPI: {
    list: vi.fn().mockResolvedValue([]),
    log: vi.fn().mockResolvedValue({}),
    get: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([]),
    barcode: vi.fn(),
    analyzeLabel: vi.fn(),
    parseMeal: vi.fn(),
    analyzeMealPhoto: vi.fn(),
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

  it('still offers manual entry and label scan when search returns matches', async () => {
    ;(foodAPI.search as any).mockResolvedValue([
      { name: 'Peanut Butter (Brand A)', calories: 190, protein: 8, carbs: 6, fat: 16, fiber: 2, sugar: 3, sodium: 140, serving_size: '2 tbsp', source: 'off' },
    ])

    renderLogFood()

    const input = await screen.findByPlaceholderText('Search food…')
    fireEvent.change(input, { target: { value: 'Peanut Butter' } })

    await screen.findByText('Peanut Butter (Brand A)')

    expect(screen.getByText(/not the right match/i)).toBeTruthy()
    expect(screen.getByText(/enter "peanut butter" manually/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /scan label/i })).toBeTruthy()
  })
})

describe('LogFood photo review flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(foodAPI.list as any).mockResolvedValue([])
    ;(foodAPI.log as any).mockResolvedValue({})
    ;(globalThis as any).createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100 })
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as any
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,abc123')
    HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation((cb: (b: Blob | null) => void) => {
      cb(new Blob(['fake'], { type: 'image/jpeg' }))
    })
  })

  it('analyzes an attached meal photo and logs the reviewed items with source photo', async () => {
    ;(foodAPI.analyzeMealPhoto as any).mockResolvedValue({
      items: [
        { name: 'Grilled chicken breast', quantity: '6 oz', calories: 280, protein: 52, carbs: 0, fat: 6, confidence: 'high', portion_reasoning: 'palm-sized relative to the plate' },
      ],
      assessment: 'High protein, low carb.',
      image_url: '/api/v1/food/photos/1/abc.jpg',
    })

    renderLogFood()

    fireEvent.click(await screen.findByText(/describe your meal/i))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['fake'], 'meal.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByAltText(/meal photo/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /analyze photo/i }))

    // Photo-review phase: assessment banner + persisted photo thumbnail render.
    await waitFor(() => expect(screen.getByText(/high protein, low carb/i)).toBeTruthy())
    expect(screen.getByAltText(/analyzed meal/i)).toBeTruthy()
    expect(screen.getAllByText(/high/i).length).toBeGreaterThan(0) // confidence badge
    expect(screen.getByText(/palm-sized relative to the plate/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /log 1 item/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.name).toBe('Grilled chicken breast')
    expect(payload.source).toBe('photo')
    expect(payload.image_url).toBe('/api/v1/food/photos/1/abc.jpg')
    expect(payload.calories).toBe(280)
  })
})
