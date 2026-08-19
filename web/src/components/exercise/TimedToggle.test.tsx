import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TimedToggle from './TimedToggle'
import * as types from '../../types'

const setTimedMock = vi.fn()
vi.mock('../../services/api', () => ({
  exerciseAPI: { setTimed: (...args: any[]) => setTimedMock(...args) },
}))

const libraryExercise: types.Exercise = {
  id: 5, name: 'Ankle Circles', muscle_group: 'calves', category: 'strength',
  equipment: '', description: '', secondary_muscles: [], source: 'free',
}

describe('TimedToggle', () => {
  beforeEach(() => setTimedMock.mockReset())

  it('marks a library exercise timed and reports the updated exercise back', async () => {
    const updated = { ...libraryExercise, is_timed: true, default_duration_seconds: 30 }
    setTimedMock.mockResolvedValue(updated)
    const onUpdated = vi.fn()

    render(<TimedToggle exercise={libraryExercise} onUpdated={onUpdated} />)
    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(setTimedMock).toHaveBeenCalledWith(5, true, 30))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
  })

  it('shows the duration input only once the exercise is timed', () => {
    render(<TimedToggle exercise={libraryExercise} onUpdated={vi.fn()} />)
    expect(screen.queryByLabelText(/default hold duration/i)).toBeNull()

    render(<TimedToggle exercise={{ ...libraryExercise, is_timed: true, default_duration_seconds: 45 }} onUpdated={vi.fn()} />)
    expect(screen.getByLabelText(/default hold duration/i)).toHaveProperty('value', '45')
  })

  it('commits a duration change on blur, not on every keystroke', () => {
    render(<TimedToggle exercise={{ ...libraryExercise, is_timed: true, default_duration_seconds: 30 }} onUpdated={vi.fn()} />)
    const input = screen.getByLabelText(/default hold duration/i)
    fireEvent.change(input, { target: { value: '60' } })
    expect(setTimedMock).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(setTimedMock).toHaveBeenCalledWith(5, true, 60)
  })
})
