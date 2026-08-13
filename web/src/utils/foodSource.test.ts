import { describe, it, expect } from 'vitest'
import { foodSourceBadge } from './foodSource'

describe('foodSourceBadge', () => {
  it('marks a USDA result with a real label panel as verified', () => {
    const badge = foodSourceBadge({ source: 'fdc', label_accurate: true })
    expect(badge).toMatchObject({ label: 'USDA label', tone: 'verified' })
  })

  it('does not claim a label for a per-100g USDA result', () => {
    // These numbers are a reference value the user still has to scale, not the
    // printed panel — borrowing the label's authority would mislead.
    const badge = foodSourceBadge({ source: 'fdc', label_accurate: false })
    expect(badge).toMatchObject({ label: 'USDA', tone: 'neutral' })
  })

  it('distinguishes per-serving Open Food Facts from per-100g', () => {
    expect(foodSourceBadge({ source: 'off', label_accurate: true })?.tone).toBe('verified')
    expect(foodSourceBadge({ source: 'off' })?.tone).toBe('neutral')
  })

  it('flags AI-derived items as estimates whether typed or photographed', () => {
    expect(foodSourceBadge({ source: 'ai' })).toMatchObject({ label: 'AI estimate', tone: 'estimate' })
    expect(foodSourceBadge({ source: 'photo' })).toMatchObject({ label: 'AI estimate', tone: 'estimate' })
  })

  it('renders no badge for a My Foods entry', () => {
    // "saved" says where it was stored, not where the numbers came from, so a
    // badge would assert an accuracy the app can't back up.
    expect(foodSourceBadge({ source: 'saved' })).toBeNull()
  })
})
