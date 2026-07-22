import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AddAIProgram from './AddAIProgram'

vi.mock('../services/api', () => ({
  programAPI: { generate: vi.fn(), create: vi.fn() },
  exerciseAPI: { list: vi.fn() },
}))

import { programAPI, exerciseAPI } from '../services/api'

const CATALOG = [
  { id: 1, name: 'Barbell Squat', muscle_group: 'legs', category: 'strength', equipment: 'barbell', secondary_muscles: [], description: '' },
]

function fillGoals(value = 'strength and agility for hockey') {
  fireEvent.change(screen.getByPlaceholderText(/build strength and agility/i), { target: { value } })
}

describe('AddAIProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(exerciseAPI.list as any).mockResolvedValue(CATALOG)
  })

  it('disables generate until goals are entered', () => {
    render(<MemoryRouter><AddAIProgram /></MemoryRouter>)
    expect((screen.getByRole('button', { name: /generate program/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the loading state while generating, then renders one review card per draft', async () => {
    let resolveGenerate: (v: any) => void
    ;(programAPI.generate as any).mockReturnValue(new Promise(resolve => { resolveGenerate = resolve }))

    render(<MemoryRouter><AddAIProgram /></MemoryRouter>)
    fillGoals()
    fireEvent.click(screen.getByRole('button', { name: /generate program/i }))

    expect(screen.getByText(/generating your program/i)).toBeTruthy()

    resolveGenerate!({
      programs: [
        { name: 'Hockey Strength — Day 1 of 2', notes: '', exercises: [{ exercise_id: 1, rest_seconds: 90, sets: [{ set_number: 1, target_reps: 5, target_weight: 0 }] }] },
        { name: 'Hockey Strength — Day 2 of 2', notes: '', exercises: [{ exercise_id: 1, rest_seconds: 60, sets: [{ set_number: 1, target_reps: 10, target_weight: 0 }] }] },
      ],
    })

    await waitFor(() => expect(screen.getByText('Hockey Strength — Day 1 of 2')).toBeTruthy())
    expect(screen.getByText('Hockey Strength — Day 2 of 2')).toBeTruthy()
  })

  it('discarding a card removes it from review', async () => {
    ;(programAPI.generate as any).mockResolvedValue({
      programs: [
        { name: 'Day 1', notes: '', exercises: [{ exercise_id: 1, rest_seconds: 90, sets: [{ set_number: 1, target_reps: 5, target_weight: 0 }] }] },
      ],
    })

    render(<MemoryRouter><AddAIProgram /></MemoryRouter>)
    fillGoals()
    fireEvent.click(screen.getByRole('button', { name: /generate program/i }))

    await waitFor(() => expect(screen.getByText('Day 1')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /discard/i }))

    await waitFor(() => expect(screen.queryByText('Day 1')).toBeNull())
    expect(screen.getByRole('button', { name: /^done$/i })).toBeTruthy()
  })

  it('saving a card calls programAPI.create and shows a link to the created program', async () => {
    ;(programAPI.generate as any).mockResolvedValue({
      programs: [
        { name: 'Day 1', notes: '', exercises: [{ exercise_id: 1, rest_seconds: 90, sets: [{ set_number: 1, target_reps: 5, target_weight: 0 }] }] },
      ],
    })
    ;(programAPI.create as any).mockResolvedValue({ id: 42, name: 'Day 1' })

    render(<MemoryRouter><AddAIProgram /></MemoryRouter>)
    fillGoals()
    fireEvent.click(screen.getByRole('button', { name: /generate program/i }))

    await waitFor(() => expect(screen.getByText('Day 1')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /create program/i }))

    await waitFor(() => expect(programAPI.create).toHaveBeenCalled())
    const link = await screen.findByRole('link', { name: /edit/i })
    expect(link.getAttribute('href')).toBe('/programs/42/edit')
  })

  it('shows a 503-specific message when the AI builder is not configured', async () => {
    ;(programAPI.generate as any).mockRejectedValue({ response: { status: 503, data: { error: 'AI program builder is not configured on this server' } } })

    render(<MemoryRouter><AddAIProgram /></MemoryRouter>)
    fillGoals()
    fireEvent.click(screen.getByRole('button', { name: /generate program/i }))

    await waitFor(() => expect(screen.getByText(/not configured on this server/i)).toBeTruthy())
  })
})
