import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MacroBar from './MacroBar'

describe('MacroBar', () => {
  it('warns when a target macro goes over', () => {
    render(<MacroBar label="Carbs" value={300} target={200} color="#f59e0b" />)
    expect(screen.getByText('+100g over')).toBeTruthy()
  })
  it('treats going past a minimum as a win, not a warning', () => {
    render(<MacroBar label="Protein" value={190} target={160} color="#10b981" kind="minimum" />)
    expect(screen.queryByText(/over/)).toBeNull()
    expect(screen.getByText('✓ +30g')).toBeTruthy()
  })
})
