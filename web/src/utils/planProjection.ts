// Shared helpers for reading a value off a weight-plan trajectory.
//
// Both the Actual-vs-Plan chart and the Journey Road need "what does the plan
// say I'll weigh on an arbitrary date?", and the projection points land on
// weekly dates that won't line up with a chart row or a holiday. This lives
// here rather than in either consumer so the two can't drift into answering
// that question differently.

import type { WeightPlanProjectionPoint } from '../types'

export interface TimelinePoint {
  ts: number
  val: number
}

/**
 * Linear interpolation across a sorted set of known points.
 *
 * Deliberately never extrapolates: a timestamp outside the known range returns
 * undefined rather than a projected value. Extending a plan line past its own
 * last projection would invent a target for a period no plan covers.
 */
export function interpolateAt(points: TimelinePoint[], ts: number): number | undefined {
  if (points.length === 0) return undefined
  if (ts <= points[0].ts) return ts === points[0].ts ? points[0].val : undefined
  const last = points[points.length - 1]
  if (ts >= last.ts) return ts === last.ts ? last.val : undefined
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (ts >= a.ts && ts <= b.ts) {
      if (b.ts === a.ts) return a.val
      const frac = (ts - a.ts) / (b.ts - a.ts)
      return a.val + (b.val - a.val) * frac
    }
  }
  return undefined
}

/**
 * Converts API projection points into the {ts, val} form interpolateAt reads,
 * dropping any point without a date and sorting ascending. Projections arrive
 * ordered in practice, but interpolateAt's scan assumes it.
 */
export function toTimelinePoints(points: WeightPlanProjectionPoint[]): TimelinePoint[] {
  return points
    .filter(p => !!p.expected_date)
    .map(p => ({ ts: new Date(p.expected_date as string).getTime(), val: p.expected_weight }))
    .filter(p => Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts)
}
