import { describe, it, expect } from 'vitest'
import { interpolateAt, toTimelinePoints } from './planProjection'
import type { WeightPlanProjectionPoint } from '../types'

const pts = [
  { ts: 1000, val: 200 },
  { ts: 2000, val: 190 },
  { ts: 3000, val: 185 },
]

describe('interpolateAt', () => {
  it('returns the exact value at a known point', () => {
    expect(interpolateAt(pts, 2000)).toBe(190)
  })

  it('interpolates linearly between two points', () => {
    expect(interpolateAt(pts, 1500)).toBe(195)
    expect(interpolateAt(pts, 2500)).toBe(187.5)
  })

  // Extending a plan line past its own last projection would invent a target
  // for a period no plan covers.
  it('never extrapolates outside the known range', () => {
    expect(interpolateAt(pts, 500)).toBeUndefined()
    expect(interpolateAt(pts, 4000)).toBeUndefined()
  })

  it('returns the endpoints exactly', () => {
    expect(interpolateAt(pts, 1000)).toBe(200)
    expect(interpolateAt(pts, 3000)).toBe(185)
  })

  it('handles an empty series', () => {
    expect(interpolateAt([], 1500)).toBeUndefined()
  })

  it('handles duplicate timestamps without dividing by zero', () => {
    expect(interpolateAt([{ ts: 1000, val: 200 }, { ts: 1000, val: 190 }], 1000)).toBe(200)
  })
})

describe('toTimelinePoints', () => {
  const mk = (week: number, weight: number, date?: string): WeightPlanProjectionPoint =>
    ({ week, expected_weight: weight, expected_date: date } as WeightPlanProjectionPoint)

  it('converts and sorts ascending by date', () => {
    const got = toTimelinePoints([
      mk(2, 185, '2026-08-21T00:00:00Z'),
      mk(0, 200, '2026-08-07T00:00:00Z'),
      mk(1, 190, '2026-08-14T00:00:00Z'),
    ])
    expect(got.map(p => p.val)).toEqual([200, 190, 185])
  })

  it('drops points with no or unparseable date', () => {
    const got = toTimelinePoints([
      mk(0, 200, '2026-08-07T00:00:00Z'),
      mk(1, 190),
      mk(2, 185, 'not-a-date'),
    ])
    expect(got).toHaveLength(1)
    expect(got[0].val).toBe(200)
  })

  it('handles an empty list', () => {
    expect(toTimelinePoints([])).toEqual([])
  })
})
