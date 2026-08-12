import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BPEntrySheet from './BPEntrySheet'

vi.mock('../services/api', () => ({
  bloodPressureAPI: {
    log: vi.fn(),
  },
}))

import { bloodPressureAPI } from '../services/api'

const savedLog = {
  id: 1, systolic: 118, diastolic: 76, rested: false,
  tz_offset: 0, logged_at: '2026-08-12T13:00:00Z', category: 'normal' as const,
}

function renderSheet(onSuccess = vi.fn()) {
  const onClose = vi.fn()
  render(<BPEntrySheet isOpen onClose={onClose} onSuccess={onSuccess} />)
  return { onClose, onSuccess }
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /save reading/i }) as HTMLButtonElement
}

function enterReading(sys: string, dia: string) {
  fireEvent.change(screen.getByLabelText('Systolic'), { target: { value: sys } })
  fireEvent.change(screen.getByLabelText('Diastolic'), { target: { value: dia } })
}

describe('BPEntrySheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(bloodPressureAPI.log).mockResolvedValue(savedLog)
  })

  it('shows the category as soon as both numbers are valid', async () => {
    renderSheet()

    expect(screen.queryByTestId('bp-live-category')).toBeNull()

    enterReading('134', '86')
    // 134 is in the stage 1 band on systolic alone.
    expect((await screen.findByTestId('bp-live-category')).textContent).toBe('Stage 1')
  })

  it('applies the "either number" rule in the live chip', async () => {
    renderSheet()

    // Systolic alone reads Elevated; the diastolic of 80 makes it Stage 1.
    enterReading('120', '80')
    expect((await screen.findByTestId('bp-live-category')).textContent).toBe('Stage 1')
  })

  it('warns on a crisis reading but still allows saving it', async () => {
    renderSheet()

    enterReading('190', '125')

    expect(await screen.findByTestId('bp-crisis-warning')).toBeTruthy()
    // Never block someone from recording their own reading.
    expect(saveButton().disabled).toBe(false)
  })

  it('sends the timezone offset and context tag with the reading', async () => {
    const { onSuccess } = renderSheet()

    enterReading('118', '76')
    fireEvent.click(saveButton())

    await waitFor(() => expect(bloodPressureAPI.log).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(bloodPressureAPI.log).mock.calls[0][0]
    expect(payload.systolic).toBe(118)
    expect(payload.diastolic).toBe(76)
    // The protocol nudges depend on these two being present on every reading.
    expect(payload.tz_offset).toBe(-new Date().getTimezoneOffset())
    expect(['morning', 'evening']).toContain(payload.context)
    expect(onSuccess).toHaveBeenCalledWith(savedLog)
  })

  it('rejects an inverted reading before hitting the API', async () => {
    renderSheet()

    enterReading('80', '120')

    // Submit is gated on the client rule, so no request goes out at all.
    expect(saveButton().disabled).toBe(true)
    expect(bloodPressureAPI.log).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const { onClose } = renderSheet()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
