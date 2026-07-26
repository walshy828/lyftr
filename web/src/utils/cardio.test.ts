import { describe, it, expect } from 'vitest'
import { isCardio, parseClock, fmtClock } from './workoutSets'
import { metersToDisplay, displayToMeters, displayDistance, distanceShort, paceLabel } from '../stores/settings'

describe('isCardio', () => {
  it('is true only for the cardio category', () => {
    expect(isCardio({ category: 'cardio' })).toBe(true)
    expect(isCardio({ category: 'strength' })).toBe(false)
    expect(isCardio({ category: '' })).toBe(false)
    expect(isCardio(null)).toBe(false)
    expect(isCardio(undefined)).toBe(false)
  })
})

describe('parseClock', () => {
  it('parses m:ss into whole seconds', () => {
    expect(parseClock('32:10')).toBe(1930)
    expect(parseClock('1:30')).toBe(90)
    expect(parseClock('0:05')).toBe(5)
  })
  it('treats a bare number as minutes', () => {
    expect(parseClock('30')).toBe(1800)
    expect(parseClock('5')).toBe(300)
  })
  it('is lenient with blanks and junk', () => {
    expect(parseClock('')).toBe(0)
    expect(parseClock('  ')).toBe(0)
  })
  it('round-trips through fmtClock', () => {
    expect(fmtClock(parseClock('12:34'))).toBe('12:34')
  })
})

describe('distance helpers (unit follows weight unit)', () => {
  it('miles for lbs, km for kg', () => {
    expect(distanceShort('lbs')).toBe('mi')
    expect(distanceShort('lb')).toBe('mi')
    expect(distanceShort('kg')).toBe('km')
  })

  it('converts meters <-> display and back without drift', () => {
    const meters = displayToMeters(3.1, 'lbs')
    expect(meters).toBeCloseTo(4988.97, 1)
    expect(metersToDisplay(meters, 'lbs')).toBeCloseTo(3.1, 5)

    const km = displayToMeters(5, 'kg')
    expect(km).toBe(5000)
    expect(metersToDisplay(km, 'kg')).toBe(5)
  })

  it('rounds display distance to 0.01', () => {
    expect(displayDistance(4988.97, 'lbs')).toBe(3.1)
    expect(displayDistance(1000, 'kg')).toBe(1)
  })
})

describe('paceLabel', () => {
  it('formats seconds-per-unit for the display unit', () => {
    // 3.1 mi in 1930s → 1930/3.1 ≈ 622.6 → rounds to 623s/mi → 10:23 /mi
    const meters = displayToMeters(3.1, 'lbs')
    expect(paceLabel(1930, meters, 'lbs')).toBe('10:23 /mi')
  })
  it('uses km when weight unit is kg', () => {
    expect(paceLabel(1500, 5000, 'kg')).toBe('5:00 /km')
  })
  it('returns empty when time or distance is missing', () => {
    expect(paceLabel(0, 5000, 'kg')).toBe('')
    expect(paceLabel(1500, 0, 'kg')).toBe('')
  })
})
