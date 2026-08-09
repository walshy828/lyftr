// Major US holidays, computed rather than hardcoded.
//
// The Journey Road uses these as milestones along a weight-loss plan: "on plan
// you'll be 198 lb by Thanksgiving" is a far more motivating frame than "week
// 15 of 30". Every date is derived from the year, so a plan spanning any
// number of years works without a lookup table to maintain.
//
// All dates are constructed in LOCAL time at midnight. Holidays are calendar
// days, not instants — a user in Los Angeles should see Christmas on Dec 25,
// and a UTC-anchored date would land on Dec 24 for them.

export interface Milestone {
  /** Stable identity, e.g. "thanksgiving-2026". */
  key: string
  name: string
  /** Rendered on the road marker. */
  emoji: string
  date: Date
}

const midnight = (year: number, month: number, day: number) => new Date(year, month, day, 0, 0, 0, 0)

/**
 * The nth occurrence of a given weekday in a month.
 * `weekday` is 0=Sunday..6=Saturday, matching Date.getDay().
 */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = midnight(year, month, 1)
  // Days to advance from the 1st to reach the first matching weekday.
  const offset = (weekday - first.getDay() + 7) % 7
  return midnight(year, month, 1 + offset + (n - 1) * 7)
}

/** The last occurrence of a given weekday in a month (Memorial Day). */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  // Day 0 of the next month is the last day of this one.
  const last = new Date(year, month + 1, 0, 0, 0, 0, 0)
  const offset = (last.getDay() - weekday + 7) % 7
  return midnight(year, month, last.getDate() - offset)
}

/**
 * Western (Gregorian) Easter Sunday, via the anonymous Gregorian algorithm.
 *
 * Easter is the one milestone here that can't be expressed as "nth weekday of
 * month" — it's the first Sunday after the paschal full moon, so it wanders
 * across five weeks (Mar 22 – Apr 25) and needs the real computus.
 */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  // n encodes the date as a day-of-March-or-April offset; 31 splits the months.
  const n = h + l - 7 * m + 114
  return midnight(year, Math.floor(n / 31) - 1, (n % 31) + 1)
}

/**
 * Every tracked holiday in one calendar year, in chronological order.
 *
 * Deliberately limited to the culturally big, food-and-gathering-heavy dates —
 * those are the ones that matter to someone on a weight-loss plan, both as
 * motivating waypoints and as the moments that derail people. A complete
 * federal-holiday list would clutter the road with markers nobody plans around.
 */
export function usHolidaysInYear(year: number): Milestone[] {
  return [
    { key: `new-years-${year}`, name: "New Year's Day", emoji: '🎉', date: midnight(year, 0, 1) },
    // Always Mar 22 – Apr 25, so it always sorts here.
    { key: `easter-${year}`, name: 'Easter', emoji: '🐰', date: easterSunday(year) },
    { key: `memorial-${year}`, name: 'Memorial Day', emoji: '🇺🇸', date: lastWeekdayOfMonth(year, 4, 1) },
    { key: `july4-${year}`, name: 'July 4th', emoji: '🎆', date: midnight(year, 6, 4) },
    { key: `labor-${year}`, name: 'Labor Day', emoji: '⛱️', date: nthWeekdayOfMonth(year, 8, 1, 1) },
    { key: `halloween-${year}`, name: 'Halloween', emoji: '🎃', date: midnight(year, 9, 31) },
    { key: `thanksgiving-${year}`, name: 'Thanksgiving', emoji: '🦃', date: nthWeekdayOfMonth(year, 10, 4, 4) },
    { key: `christmas-${year}`, name: 'Christmas', emoji: '🎄', date: midnight(year, 11, 25) },
  ]
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How far a filler must sit from the milestones it separates. A waypoint a few
 * days off Labor Day reads as a duplicate pin rather than progress, and the two
 * labels collide on the road.
 */
const MIN_FILLER_SPACING_DAYS = 21

/** The 1st of the month `n` months on from `d`'s. */
const monthStart = (d: Date, n = 0) => midnight(d.getFullYear(), d.getMonth() + n, 1)

/** The same day-of-month `n` months on, normalised by Date for short months. */
const addMonths = (d: Date, n: number) => midnight(d.getFullYear(), d.getMonth() + n, d.getDate())

/**
 * Waypoints filling a stretch of calendar with no holiday in it.
 *
 * The tracked holidays bunch into the back half of the year — between New
 * Year's and Easter the road can run five months without a single marker,
 * which is exactly the stretch where someone needs one. When two milestones sit
 * more than two months apart, this drops a marker on the 1st of every other
 * month between them, so the road stays evenly paced year-round.
 */
function fillersBetween(a: Date, b: Date): Milestone[] {
  if (addMonths(a, 2).getTime() >= b.getTime()) return []

  const out: Milestone[] = []
  for (let m = monthStart(a, 2); m.getTime() < b.getTime(); m = monthStart(m, 2)) {
    const fromA = (m.getTime() - a.getTime()) / DAY_MS
    const toB = (b.getTime() - m.getTime()) / DAY_MS
    if (fromA < MIN_FILLER_SPACING_DAYS || toB < MIN_FILLER_SPACING_DAYS) continue
    out.push({
      key: `month-${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
      name: MONTH_NAMES[m.getMonth()],
      emoji: '📅',
      date: m,
    })
  }
  return out
}

/**
 * Every milestone falling within [from, to], inclusive, in chronological order:
 * the tracked holidays, plus month-start waypoints wherever those leave a gap
 * longer than two months (see `fillersBetween`).
 *
 * The window's own ends count as anchors for that spacing rule — the road
 * starts where the plan starts and finishes at its goal, so a plan beginning in
 * January gets waypoints before its first holiday rather than a bare run of
 * road. Spans any number of years. Returns an empty array when the window is
 * inverted or too short to contain anything — callers should treat that as "no
 * milestones to draw" rather than an error.
 */
export function usHolidaysBetween(from: Date, to: Date): Milestone[] {
  const startTs = from.getTime()
  const endTs = to.getTime()
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) return []

  const holidays: Milestone[] = []
  for (let year = from.getFullYear(); year <= to.getFullYear(); year++) {
    for (const h of usHolidaysInYear(year)) {
      const ts = h.date.getTime()
      if (ts >= startTs && ts <= endTs) holidays.push(h)
    }
  }
  holidays.sort((a, b) => a.date.getTime() - b.date.getTime())

  // Walk the gaps between consecutive anchors, the window ends included.
  const anchors = [from, ...holidays.map(h => h.date), to]
  const fillers: Milestone[] = []
  for (let i = 0; i < anchors.length - 1; i++) {
    fillers.push(...fillersBetween(anchors[i], anchors[i + 1]))
  }

  return [...holidays, ...fillers].sort((a, b) => a.date.getTime() - b.date.getTime())
}
