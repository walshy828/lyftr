import { describe, it, expect } from 'vitest'
import { usHolidaysInYear, usHolidaysBetween } from './holidays'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const find = (year: number, key: string) => usHolidaysInYear(year).find(h => h.key === `${key}-${year}`)!

describe('usHolidaysInYear', () => {
  it('places the fixed-date holidays', () => {
    expect(iso(find(2026, 'new-years').date)).toBe('2026-01-01')
    expect(iso(find(2026, 'july4').date)).toBe('2026-07-04')
    expect(iso(find(2026, 'halloween').date)).toBe('2026-10-31')
    expect(iso(find(2026, 'christmas').date)).toBe('2026-12-25')
  })

  // The computed ones are the whole reason this isn't a hardcoded table —
  // each is pinned against the real calendar for several years.
  it('computes Memorial Day as the last Monday in May', () => {
    expect(iso(find(2025, 'memorial').date)).toBe('2025-05-26')
    expect(iso(find(2026, 'memorial').date)).toBe('2026-05-25')
    expect(iso(find(2027, 'memorial').date)).toBe('2027-05-31')
  })

  it('computes Labor Day as the first Monday in September', () => {
    expect(iso(find(2025, 'labor').date)).toBe('2025-09-01')
    expect(iso(find(2026, 'labor').date)).toBe('2026-09-07')
    expect(iso(find(2027, 'labor').date)).toBe('2027-09-06')
  })

  it('computes Thanksgiving as the fourth Thursday in November', () => {
    expect(iso(find(2025, 'thanksgiving').date)).toBe('2025-11-27')
    expect(iso(find(2026, 'thanksgiving').date)).toBe('2026-11-26')
    expect(iso(find(2027, 'thanksgiving').date)).toBe('2027-11-25')
  })

  it('returns holidays in chronological order', () => {
    const dates = usHolidaysInYear(2026).map(h => h.date.getTime())
    expect(dates).toEqual([...dates].sort((a, b) => a - b))
  })

  // Dates are calendar days, not instants — a UTC-anchored midnight would show
  // Christmas on Dec 24 for anyone west of Greenwich.
  it('anchors dates at local midnight', () => {
    const xmas = find(2026, 'christmas').date
    expect(xmas.getHours()).toBe(0)
    expect(xmas.getDate()).toBe(25)
  })
})

describe('usHolidaysBetween', () => {
  it('includes only holidays inside the window', () => {
    const got = usHolidaysBetween(new Date(2026, 5, 1), new Date(2026, 10, 1))
    expect(got.map(h => h.name)).toEqual(['July 4th', 'Labor Day', 'Halloween'])
  })

  it('is inclusive of both endpoints', () => {
    const got = usHolidaysBetween(new Date(2026, 6, 4), new Date(2026, 9, 31))
    expect(got.map(h => h.name)).toEqual(['July 4th', 'Labor Day', 'Halloween'])
  })

  it('spans multiple years in order', () => {
    const got = usHolidaysBetween(new Date(2025, 10, 1), new Date(2027, 0, 15))
    expect(got[0].name).toBe('Thanksgiving')
    expect(got[0].date.getFullYear()).toBe(2025)
    expect(got[got.length - 1].name).toBe("New Year's Day")
    expect(got[got.length - 1].date.getFullYear()).toBe(2027)
    const ts = got.map(h => h.date.getTime())
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
  })

  it('returns nothing for a window containing no holiday', () => {
    expect(usHolidaysBetween(new Date(2026, 1, 1), new Date(2026, 2, 1))).toEqual([])
  })

  it('returns nothing for an inverted window rather than throwing', () => {
    expect(usHolidaysBetween(new Date(2026, 10, 1), new Date(2026, 1, 1))).toEqual([])
  })

  it('gives every milestone a unique key across years', () => {
    const keys = usHolidaysBetween(new Date(2025, 0, 1), new Date(2027, 11, 31)).map(h => h.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
