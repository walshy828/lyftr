import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SourceFilter from './SourceFilter'

describe('SourceFilter', () => {
  it('marks the selected sources as on', () => {
    render(<SourceFilter value={['fdc']} onChange={() => {}} />)

    expect(screen.getByRole('switch', { name: /FoodData Central/i }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: /Open Food Facts/i }).getAttribute('aria-checked')).toBe('false')
  })

  it('adds a source when an off one is tapped', () => {
    const onChange = vi.fn()
    render(<SourceFilter value={['fdc']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('switch', { name: /Open Food Facts/i }))
    expect(onChange).toHaveBeenCalledWith(['fdc', 'off'])
  })

  it('removes a source when one of several is tapped', () => {
    const onChange = vi.fn()
    render(<SourceFilter value={['off', 'fdc']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('switch', { name: /Open Food Facts/i }))
    expect(onChange).toHaveBeenCalledWith(['fdc'])
  })

  it('refuses to turn off the last remaining source', () => {
    // Searching zero databases returns zero results, which the user reads as
    // "this food doesn't exist" rather than "you switched everything off".
    const onChange = vi.fn()
    render(<SourceFilter value={['fdc']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('switch', { name: /FoodData Central/i }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
