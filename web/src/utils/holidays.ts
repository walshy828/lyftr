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
    { key: `memorial-${year}`, name: 'Memorial Day', emoji: '🇺🇸', date: lastWeekdayOfMonth(year, 4, 1) },
    { key: `july4-${year}`, name: 'July 4th', emoji: '🎆', date: midnight(year, 6, 4) },
    { key: `labor-${year}`, name: 'Labor Day', emoji: '⛱️', date: nthWeekdayOfMonth(year, 8, 1, 1) },
    { key: `halloween-${year}`, name: 'Halloween', emoji: '🎃', date: midnight(year, 9, 31) },
    { key: `thanksgiving-${year}`, name: 'Thanksgiving', emoji: '🦃', date: nthWeekdayOfMonth(year, 10, 4, 4) },
    { key: `christmas-${year}`, name: 'Christmas', emoji: '🎄', date: midnight(year, 11, 25) },
  ]
}

/**
 * Every tracked holiday falling within [from, to], inclusive, in chronological
 * order. Spans any number of years. Returns an empty array when the window is
 * inverted or too short to contain one — callers should treat that as "no
 * milestones to draw" rather than an error.
 */
export function usHolidaysBetween(from: Date, to: Date): Milestone[] {
  const startTs = from.getTime()
  const endTs = to.getTime()
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) return []

  const out: Milestone[] = []
  for (let year = from.getFullYear(); year <= to.getFullYear(); year++) {
    for (const h of usHolidaysInYear(year)) {
      const ts = h.date.getTime()
      if (ts >= startTs && ts <= endTs) out.push(h)
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime())
}
