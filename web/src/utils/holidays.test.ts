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

  // Easter can't be expressed as "nth weekday of month" — it wanders across
  // five weeks, so the computus is pinned against the real calendar, including
  // both extremes of its range.
  it('computes Western Easter Sunday', () => {
    expect(iso(find(2024, 'easter').date)).toBe('2024-03-31')
    expect(iso(find(2025, 'easter').date)).toBe('2025-04-20')
    expect(iso(find(2026, 'easter').date)).toBe('2026-04-05')
    expect(iso(find(2027, 'easter').date)).toBe('2027-03-28')
    expect(iso(find(2028, 'easter').date)).toBe('2028-04-16')
    expect(iso(find(2038, 'easter').date)).toBe('2038-04-25') // latest it can fall
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

describe('usHolidaysBetween month-start fillers', () => {
  // The motivating case: the tracked holidays bunch into the back half of the
  // year, so a plan starting in January used to run five empty months before
  // its first marker.
  it('fills the long run between New Year\'s and Easter', () => {
    const got = usHolidaysBetween(new Date(2026, 0, 1), new Date(2026, 11, 31))
    expect(got.map(h => `${iso(h.date)} ${h.name}`)).toEqual([
      '2026-01-01 New Year\'s Day',
      '2026-03-01 March',
      '2026-04-05 Easter',
      '2026-05-25 Memorial Day',
      '2026-07-04 July 4th',
      '2026-09-07 Labor Day',
      '2026-10-31 Halloween',
      '2026-11-26 Thanksgiving',
      '2026-12-25 Christmas',
    ])
  })

  it('lands fillers on the 1st, every other month', () => {
    // Nothing tracked falls between New Year's and Easter 2027 (Mar 28), and
    // the window start pushes the cadence out from January.
    const got = usHolidaysBetween(new Date(2027, 0, 1), new Date(2027, 5, 1))
    const fillers = got.filter(h => h.key.startsWith('month-'))
    expect(fillers.map(h => iso(h.date))).toEqual(['2027-03-01', '2027-05-01'])
    expect(fillers.every(h => h.date.getDate() === 1)).toBe(true)
  })

  it('leaves gaps of two months or less alone', () => {
    // Memorial Day (May 25) → July 4th is under two months; no waypoint belongs
    // between them.
    const got = usHolidaysBetween(new Date(2026, 4, 25), new Date(2026, 6, 4))
    expect(got.map(h => h.name)).toEqual(['Memorial Day', 'July 4th'])
  })

  it('skips a filler that would crowd the milestone it separates', () => {
    // July 4th → Labor Day (Sep 7, 2026) clears two months, but the candidate
    // 1st lands Sep 1 — six days off Labor Day, which reads as a duplicate pin.
    const got = usHolidaysBetween(new Date(2026, 6, 4), new Date(2026, 8, 7))
    expect(got.map(h => h.name)).toEqual(['July 4th', 'Labor Day'])
  })

  it('treats the window ends as anchors, so a plan starting mid-gap gets waypoints', () => {
    const got = usHolidaysBetween(new Date(2026, 0, 10), new Date(2026, 6, 1))
    expect(got.map(h => `${iso(h.date)} ${h.name}`)).toEqual([
      '2026-03-01 March',
      '2026-04-05 Easter',
      '2026-05-25 Memorial Day',
    ])
  })

  it('keeps fillers chronological and uniquely keyed alongside the holidays', () => {
    const got = usHolidaysBetween(new Date(2025, 0, 1), new Date(2027, 11, 31))
    const ts = got.map(h => h.date.getTime())
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
    expect(new Set(got.map(h => h.key)).size).toBe(got.length)
    // Every gap on a three-year road is now at most ~2 months of empty calendar.
    const maxGapDays = Math.max(...ts.slice(1).map((t, i) => (t - ts[i]) / 86_400_000))
    expect(maxGapDays).toBeLessThan(70)
  })
})
