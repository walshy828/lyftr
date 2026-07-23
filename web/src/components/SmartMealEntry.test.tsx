import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SmartMealEntry from './SmartMealEntry'

vi.mock('../services/api', () => ({
  foodAPI: { parseMeal: vi.fn(), analyzeMealPhoto: vi.fn() },
}))

import { foodAPI } from '../services/api'

// jsdom has no real canvas/image-decoding pipeline — stub just enough of the
// downscale path (createImageBitmap -> canvas -> toBlob) for a picked file to
// resolve to *some* base64 payload, without asserting on image content.
function stubImagePipeline() {
  ;(globalThis as any).createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100 })
  const getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() })
  HTMLCanvasElement.prototype.getContext = getContext as any
  HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,abc123')
  HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation((cb: (b: Blob | null) => void) => {
    cb(new Blob(['fake'], { type: 'image/jpeg' }))
  })
}

describe('SmartMealEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables submit until text or a photo is present', () => {
    render(<SmartMealEntry onTextResult={() => {}} onPhotoResult={() => {}} onClose={() => {}} />)
    expect((screen.getByRole('button', { name: /parse meal/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('parses text-only entries via parseMeal and routes to onTextResult', async () => {
    ;(foodAPI.parseMeal as any).mockResolvedValue({ items: [{ name: 'Apple', calories: 95, protein: 0, carbs: 25, fat: 0 }] })
    const onTextResult = vi.fn()
    render(<SmartMealEntry onTextResult={onTextResult} onPhotoResult={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/turkey sandwich/i), { target: { value: 'an apple' } })
    fireEvent.click(screen.getByRole('button', { name: /parse meal/i }))

    await waitFor(() => expect(onTextResult).toHaveBeenCalledWith([
      { name: 'Apple', calories: 95, protein: 0, carbs: 25, fat: 0 },
    ]))
    expect(foodAPI.analyzeMealPhoto).not.toHaveBeenCalled()
  })

  it('shows the 503 unavailable message from the server on text submit', async () => {
    ;(foodAPI.parseMeal as any).mockRejectedValue({ response: { status: 503, data: { error: 'Smart food entry is unavailable right now' } } })
    render(<SmartMealEntry onTextResult={() => {}} onPhotoResult={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/turkey sandwich/i), { target: { value: 'an apple' } })
    fireEvent.click(screen.getByRole('button', { name: /parse meal/i }))

    await waitFor(() => expect(screen.getByText(/unavailable right now/i)).toBeTruthy())
  })

  it('attaching a photo switches submission to analyzeMealPhoto with the typed description', async () => {
    stubImagePipeline()
    ;(foodAPI.analyzeMealPhoto as any).mockResolvedValue({
      items: [{ name: 'Grilled chicken', calories: 280, protein: 52, carbs: 0, fat: 6, confidence: 'high' }],
      assessment: 'High protein.',
      image_url: '/api/v1/food/photos/1/abc.jpg',
    })
    const onPhotoResult = vi.fn()
    render(<SmartMealEntry onTextResult={() => {}} onPhotoResult={onPhotoResult} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/turkey sandwich/i), { target: { value: 'with rice' } })

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['fake'], 'meal.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByAltText(/meal photo/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /analyze photo/i }))

    await waitFor(() => expect(onPhotoResult).toHaveBeenCalled())
    expect(foodAPI.analyzeMealPhoto).toHaveBeenCalledWith('ZmFrZQ==', 'image/jpeg', 'with rice')
    expect(foodAPI.parseMeal).not.toHaveBeenCalled()
  })

  it('lets the user remove an attached photo before submitting', async () => {
    stubImagePipeline()
    render(<SmartMealEntry onTextResult={() => {}} onPhotoResult={() => {}} onClose={() => {}} />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['fake'], 'meal.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByAltText(/meal photo/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }))

    expect(screen.queryByAltText(/meal photo/i)).toBeNull()
    expect((screen.getByRole('button', { name: /parse meal/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})
