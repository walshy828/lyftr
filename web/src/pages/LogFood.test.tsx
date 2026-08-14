import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LogFood from './LogFood'

vi.mock('../services/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: new Blob() }) },
  foodAPI: {
    list: vi.fn().mockResolvedValue([]),
    recent: vi.fn().mockResolvedValue([]),
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

// The real scanner opens a camera stream, which jsdom has none of. Standing in
// a button for it keeps the scan → lookup → portion-picker path testable.
vi.mock('../components/BarcodeScanner', () => ({
  default: ({ onResult }: { onResult: (code: string) => void }) => (
    <button onClick={() => onResult('048500018002')}>Simulate scan</button>
  ),
}))

import { foodAPI, savedFoodsAPI } from '../services/api'

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
    const input = await screen.findByPlaceholderText(/search your foods/i)
    fireEvent.change(input, { target: { value: 'Homemade Chili' } })

    await waitFor(() => expect(screen.getByText(/enter "homemade chili" manually/i)).toBeTruthy())
    fireEvent.click(screen.getByText(/enter "homemade chili" manually/i))

    // Detail phase: name field is pre-filled from the query, macros start at 0
    const nameInput = await screen.findByPlaceholderText('Food name')
    expect((nameInput as HTMLInputElement).value).toBe('Homemade Chili')

    const calorieInput = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(calorieInput, { target: { value: '400' } })

    // Bump the amount to 2 — the calorie input shows the total, so editing it
    // after the bump should still reflect back into the per-serving base. A
    // hand-entered food has no gram basis, so the amount *is* the multiplier.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2' } })

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

    const input = await screen.findByPlaceholderText(/search your foods/i)
    fireEvent.change(input, { target: { value: 'Peanut Butter' } })

    await screen.findByText('Peanut Butter (Brand A)')

    // Manual entry stays reachable without scrolling past the results, and the
    // capture bar keeps label scanning one tap away.
    expect(screen.getByText(/enter "peanut butter" manually/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /label/i })).toBeTruthy()
  })

  it('offers manual entry with an empty query and in every filter', async () => {
    renderLogFood()
    await screen.findByPlaceholderText(/search your foods/i)

    expect(screen.getByText(/add a food manually/i)).toBeTruthy()

    for (const filter of ['Recent', 'My Foods', 'Database']) {
      fireEvent.click(screen.getByRole('button', { name: filter }))
      expect(screen.getByText(/add a food manually/i)).toBeTruthy()
    }
  })
})

describe('LogFood unified search', () => {
  const recentEntry = {
    id: 7, name: 'Mayonnaise', brand: "Hellmann's", meal: 'lunch',
    calories: 94, protein: 0, carbs: 0, fat: 10, fiber: 0, sugar: 0, sodium: 90, cholesterol: 5,
    servings: 1, serving_size: '1 tbsp', serving_size_grams: 14,
    source: 'off', logged_at: '2026-01-01T12:00:00Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(foodAPI.list as any).mockResolvedValue([])
    ;(foodAPI.recent as any).mockResolvedValue([recentEntry, { ...recentEntry, id: 8, name: 'Mustard', brand: '' }])
    ;(savedFoodsAPI.list as any).mockResolvedValue([])
    ;(foodAPI.search as any).mockResolvedValue([])
  })

  it('filters your own foods as you type, without waiting on the database', async () => {
    renderLogFood()

    const input = await screen.findByPlaceholderText(/search your foods/i)
    await waitFor(() => expect(screen.getByText('Mustard')).toBeTruthy())

    fireEvent.change(input, { target: { value: 'mayo' } })

    // Filtering is local, so it applies immediately — before the 300ms debounce
    // has even fired the database request.
    expect(screen.getByText('Mayonnaise')).toBeTruthy()
    expect(screen.queryByText('Mustard')).toBeNull()
    expect(foodAPI.search).not.toHaveBeenCalled()
  })

  it('shows your foods and database results together in one list', async () => {
    ;(foodAPI.search as any).mockResolvedValue([
      { name: 'Mayonnaise, light', calories: 350, protein: 0, carbs: 5, fat: 35, fiber: 0, serving_size: 'per 100g', serving_size_grams: 100, source: 'fdc' },
    ])

    renderLogFood()
    fireEvent.change(await screen.findByPlaceholderText(/search your foods/i), { target: { value: 'mayo' } })

    await waitFor(() => expect(screen.getByText('Mayonnaise, light')).toBeTruthy())
    expect(screen.getByText('Mayonnaise')).toBeTruthy()
    expect(screen.getByText(/your foods/i)).toBeTruthy()
    expect(screen.getByText(/food database/i)).toBeTruthy()
  })
})

describe('LogFood condensed quick-log (My Foods)', () => {
  const savedFood = {
    id: 1, name: 'Greek Yogurt', brand: 'Fage',
    calories: 120, protein: 20, carbs: 7, fat: 0, fiber: 0, sugar: 5, sodium: 60, cholesterol: 10,
    serving_size: '1 cup', image_url: '/api/v1/saved-foods/1/img.jpg',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(foodAPI.list as any).mockResolvedValue([])
    ;(foodAPI.log as any).mockResolvedValue({})
    ;(savedFoodsAPI.list as any).mockResolvedValue([savedFood])
  })

  it('renders a condensed view (no macro-grid inputs, read-only nutrition) and logs quickly', async () => {
    renderLogFood()

    fireEvent.click(await screen.findByText('Greek Yogurt'))

    // Condensed detail: calories render as read-only text, not a macro-grid input.
    // The only spinbutton is the portion amount.
    await waitFor(() => expect(screen.getByText('120')).toBeTruthy())
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    // No "Save to My Foods" toggle in condensed mode — it's already saved.
    expect(screen.queryByText(/save to my foods/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.name).toBe('Greek Yogurt')
    expect(payload.calories).toBe(120)
    expect(payload.protein).toBe(20)
    expect(payload.source).toBe('saved')
  })

  it('keeps the full editable review for search results', async () => {
    ;(foodAPI.search as any).mockResolvedValue([
      { name: 'Peanut Butter', calories: 190, protein: 8, carbs: 6, fat: 16, fiber: 2, sugar: 3, sodium: 140, serving_size: '2 tbsp', source: 'off' },
    ])

    renderLogFood()

    const input = await screen.findByPlaceholderText(/search your foods/i)
    fireEvent.change(input, { target: { value: 'Peanut Butter' } })
    fireEvent.click(await screen.findByText('Peanut Butter'))

    // Full review exposes editable calorie + macro-grid inputs (many spinbuttons).
    await waitFor(() => expect(screen.getAllByRole('spinbutton').length).toBeGreaterThan(2))
  })
})

describe('LogFood portions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(foodAPI.list as any).mockResolvedValue([])
    ;(foodAPI.log as any).mockResolvedValue({})
    ;(foodAPI.recent as any).mockResolvedValue([])
    ;(savedFoodsAPI.list as any).mockResolvedValue([])
  })

  it('logs a per-100g food by a household measure instead of a fraction of a serving', async () => {
    // The motivating case: mayo is quoted per 100 g, but nobody eats 100 g of
    // it. Picking "1 tbsp" must scale the macros to the tbsp, not to a serving.
    ;(foodAPI.search as any).mockResolvedValue([
      {
        name: 'Mayonnaise', brand: "Hellmann's",
        calories: 680, protein: 1, carbs: 0.6, fat: 75, fiber: 0, sugar: 0.6, sodium: 635, cholesterol: 42,
        serving_size: 'per 100g', serving_size_grams: 100,
        portions: [{ label: '1 tbsp', grams: 14 }],
        source: 'fdc',
      },
    ])

    renderLogFood()
    fireEvent.change(await screen.findByPlaceholderText(/search your foods/i), { target: { value: 'mayonnaise' } })
    fireEvent.click(await screen.findByText('Mayonnaise'))

    fireEvent.change(await screen.findByLabelText('Unit'), { target: { value: 'portion:1 tbsp' } })
    await waitFor(() => expect(screen.getByText(/1 tbsp = 14 g/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.calories).toBeCloseTo(95.2, 1)  // 680 per 100 g × 14/100
    expect(payload.fat).toBeCloseTo(10.5, 1)       // 75 per 100 g × 14/100

    // The entry is stored against the unit the user chose, so all three fields
    // describe the same thing and it reads back as "1 tbsp" — not as 0.14 of a
    // 100 g serving, which is what the raw multiplier would have recorded.
    expect(payload.servings).toBe(1)
    expect(payload.serving_size).toBe('1 tbsp')
    expect(payload.serving_size_grams).toBe(14)
  })

  it('logs a scanned drink by the half cup, exactly, with no density involved', async () => {
    // A drink's panel states only millilitres, so before volume units existed
    // this food had no basis at all and offered nothing but a 0.5-step
    // multiplier. Cups convert against ml directly — no density, no estimate.
    ;(foodAPI.barcode as any).mockResolvedValue({
      name: 'Orange Juice', brand: 'Tropicana',
      calories: 110, protein: 2, carbs: 26, fat: 0, fiber: 0, sugar: 22, sodium: 0, cholesterol: 0,
      serving_size: '240 ml', serving_size_grams: 0, serving_size_ml: 240,
      barcode: '048500018002', source: 'off', label_accurate: true,
    })

    renderLogFood()
    fireEvent.click(await screen.findByRole('button', { name: /barcode/i }))
    fireEvent.click(await screen.findByText('Simulate scan'))

    fireEvent.change(await screen.findByLabelText('Unit'), { target: { value: 'cup' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.5' } })

    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    // Half a cup is 120 of the 240 ml serving — half the macros, precisely.
    expect(payload.calories).toBeCloseTo(55, 1)
    expect(payload.carbs).toBeCloseTo(13, 1)
    expect(payload.servings).toBe(0.5)
    expect(payload.serving_size).toBe('cup')
    expect(payload.serving_size_ml).toBe(240)
    // No mass was ever published for this juice, and an assumed one is not
    // recorded as though it were the product's own.
    expect(payload.serving_size_grams).toBe(0)
  })

  it('offers cups on a mass-based food and says the conversion is an estimate', async () => {
    ;(foodAPI.search as any).mockResolvedValue([
      {
        name: 'All-Purpose Flour', calories: 364, protein: 10, carbs: 76, fat: 1, fiber: 3,
        serving_size: 'per 100g', serving_size_grams: 100, source: 'fdc',
      },
    ])

    renderLogFood()
    fireEvent.change(await screen.findByPlaceholderText(/search your foods/i), { target: { value: 'flour' } })
    fireEvent.click(await screen.findByText('All-Purpose Flour'))

    fireEvent.change(await screen.findByLabelText('Unit'), { target: { value: 'cup' } })
    // Nobody published a density for this flour, so the cup rests on 1 g/ml and
    // the user is told so rather than shown a confident 240 g.
    await waitFor(() => expect(screen.getByText(/1 cup ≈ 240 g \(estimated\)/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.calories).toBeCloseTo(873.6, 1) // 364 per 100 g × 240 g
    expect(payload.servings).toBe(1)
    expect(payload.serving_size).toBe('cup')
    expect(payload.serving_size_grams).toBe(0) // estimated, so not asserted as fact
    expect(payload.serving_size_ml).toBe(240)
  })

  it('reopens a logged entry on the unit it was logged with', async () => {
    // The stored trio (servings / serving_size / serving_size_grams) must
    // describe one another, or editing a tbsp of mayo reopens as a fraction of
    // a 100 g serving and every macro on screen is restated against the wrong
    // basis.
    ;(foodAPI.get as any).mockResolvedValue({
      id: 42, name: 'Mayonnaise', brand: "Hellmann's", meal: 'lunch',
      calories: 190, protein: 0.2, carbs: 0.2, fat: 21, fiber: 0, sugar: 0.2, sodium: 178, cholesterol: 12,
      servings: 2, serving_size: '1 tbsp', serving_size_grams: 14,
      source: 'fdc', logged_at: '2026-01-01T12:00:00Z',
    })

    renderLogFood('/food/log?edit=42&date=2026-01-01')

    const amountInput = await screen.findByLabelText('Amount')
    expect((amountInput as HTMLInputElement).value).toBe('2')
    expect((await screen.findByLabelText('Unit') as HTMLSelectElement).selectedOptions[0].text).toBe('1 tbsp')
    // Per-unit macros, back-solved from the stored totals: 190 / 2 tbsp.
    expect(screen.getByText(/1 tbsp = 14 g/)).toBeTruthy()
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('190')
  })

  it('falls back to a plain multiplier when the food has no gram basis', async () => {
    ;(foodAPI.search as any).mockResolvedValue([
      { name: 'Homemade Soup', calories: 200, protein: 10, carbs: 20, fat: 5, fiber: 2, serving_size: '1 bowl', source: 'off' },
    ])

    renderLogFood()
    fireEvent.change(await screen.findByPlaceholderText(/search your foods/i), { target: { value: 'soup' } })
    fireEvent.click(await screen.findByText('Homemade Soup'))

    // Only the food's own serving is offered — we never invent a conversion.
    const unitSelect = await screen.findByLabelText('Unit')
    expect(unitSelect.querySelectorAll('option')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.servings).toBe(2)
    expect(payload.calories).toBe(400)
  })

  it('lets a hand-entered food name its own serving and logs it under that name', async () => {
    // The motivating case for the serving editor: a manual entry opens on the
    // placeholder "1 serving" with nothing else in the dropdown. Naming the
    // serving is the only way the stored entry says what was actually eaten.
    renderLogFood()
    fireEvent.change(await screen.findByPlaceholderText(/search your foods/i), { target: { value: 'Granola' } })
    fireEvent.click(await screen.findByText(/enter "granola" manually/i))

    await screen.findByPlaceholderText('Food name')
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '120' } })

    fireEvent.click(screen.getByRole('button', { name: /edit serving/i }))
    fireEvent.change(await screen.findByLabelText('Serving size'), { target: { value: '1/4 cup' } })

    await waitFor(() =>
      expect((screen.getByLabelText('Unit') as HTMLSelectElement).selectedOptions[0].text).toBe('1/4 cup'),
    )

    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.servings).toBe(1)
    expect(payload.serving_size).toBe('1/4 cup')
    expect(payload.calories).toBe(120)
  })

  it('unlocks g and oz once the serving has a weight, without restating the macros', async () => {
    renderLogFood()
    fireEvent.change(await screen.findByPlaceholderText(/search your foods/i), { target: { value: 'Granola' } })
    fireEvent.click(await screen.findByText(/enter "granola" manually/i))

    await screen.findByPlaceholderText('Food name')
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '120' } })

    fireEvent.click(screen.getByRole('button', { name: /edit serving/i }))
    fireEvent.change(await screen.findByLabelText('Serving size'), { target: { value: '1/4 cup' } })
    fireEvent.change(screen.getByLabelText('Serving weight in grams'), { target: { value: '30' } })

    // The weight only adds units — the serving option's own mass *is* the basis,
    // so the multiplier stays 1 and the calorie total must not move.
    const unitSelect = await screen.findByLabelText('Unit')
    await waitFor(() => expect(unitSelect.querySelectorAll('option')).toHaveLength(8))
    expect([...unitSelect.querySelectorAll('option')].map(o => o.textContent))
      .toEqual(['1/4 cup', 'g', 'oz', 'tsp', 'tbsp', 'fl oz', 'cup', 'ml'])
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('120')

    fireEvent.change(unitSelect, { target: { value: 'g' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.servings).toBe(60)          // 60 of the chosen unit (g)
    expect(payload.serving_size).toBe('g')
    expect(payload.serving_size_grams).toBe(1)
    expect(payload.calories).toBe(240)         // 120 per 30 g × 60 g
  })

  it('falls back to the serving when the weight that unlocked g is cleared', async () => {
    renderLogFood()
    fireEvent.change(await screen.findByPlaceholderText(/search your foods/i), { target: { value: 'Granola' } })
    fireEvent.click(await screen.findByText(/enter "granola" manually/i))

    await screen.findByPlaceholderText('Food name')
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '120' } })

    fireEvent.click(screen.getByRole('button', { name: /edit serving/i }))
    fireEvent.change(await screen.findByLabelText('Serving size'), { target: { value: '1/4 cup' } })
    const gramsInput = screen.getByLabelText('Serving weight in grams')
    fireEvent.change(gramsInput, { target: { value: '30' } })

    const unitSelect = await screen.findByLabelText('Unit')
    await waitFor(() => expect(unitSelect.querySelectorAll('option')).toHaveLength(8))
    fireEvent.change(unitSelect, { target: { value: 'g' } })

    // Clearing the weight destroys the g option the picker is sitting on; the
    // selection has to land back on the serving rather than a dead id.
    fireEvent.change(gramsInput, { target: { value: '' } })
    await waitFor(() => expect(unitSelect.querySelectorAll('option')).toHaveLength(1))
    expect((unitSelect as HTMLSelectElement).selectedOptions[0].text).toBe('1/4 cup')

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /log food/i }))

    await waitFor(() => expect(foodAPI.log).toHaveBeenCalled())
    const payload = (foodAPI.log as any).mock.calls[0][0]
    expect(payload.servings).toBe(2)
    expect(payload.serving_size).toBe('1/4 cup')
    expect(payload.serving_size_grams).toBe(0)
    expect(payload.calories).toBe(240)
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

    fireEvent.click(await screen.findByRole('button', { name: 'Describe' }))

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
