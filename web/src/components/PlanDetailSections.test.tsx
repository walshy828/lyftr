import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlanDetailSections from './PlanDetailSections'

describe('PlanDetailSections', () => {
  const detail = {
    summary: '1,800 kcal/day to reach 190 lbs in about 12 weeks.',
    sections: [
      { heading: 'How these targets were built', bullets: ['TDEE is about 2,300 kcal', 'A 500 kcal deficit gives ~1 lb/week'] },
      { heading: 'Safety', bullets: ['Never drop below 1,500 kcal'] },
    ],
  }

  it('renders the summary, headings, and every bullet as a list item', () => {
    render(<PlanDetailSections detail={detail} />)
    expect(screen.getByText(detail.summary)).toBeTruthy()
    expect(screen.getByText('How these targets were built')).toBeTruthy()
    expect(screen.getByText('Safety')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('falls back to the plain-text notes for plans accepted before structured text existed', () => {
    render(<PlanDetailSections fallback="An older plan stored as one paragraph." />)
    expect(screen.getByText('An older plan stored as one paragraph.')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders nothing when there is neither structured detail nor a fallback', () => {
    const { container } = render(<PlanDetailSections />)
    expect(container.textContent).toBe('')
  })

  it('skips empty sections rather than emitting a bare heading', () => {
    render(<PlanDetailSections detail={{ summary: 'Summary.', sections: [{ heading: '', bullets: [] }] }} />)
    expect(screen.queryAllByRole('list')).toHaveLength(0)
  })

  it('renders markup-looking text literally — the AI is asked for plain strings, not markdown', () => {
    render(
      <PlanDetailSections
        detail={{ summary: '', sections: [{ heading: 'Notes', bullets: ['**not bold** and <b>not html</b>'] }] }}
      />
    )
    const item = screen.getByRole('listitem')
    expect(item.textContent).toContain('**not bold** and <b>not html</b>')
    expect(item.querySelector('b')).toBeNull()
  })
})
