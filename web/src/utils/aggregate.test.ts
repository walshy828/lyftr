import { describe, it, expect } from 'vitest'
import { aggregateByPeriod } from './aggregate'

interface Row { day: string; value: number; total: number }

const rows: Row[] = [
  { day: '2026-01-05', value: 10, total: 100 }, // Mon, week of Jan 5
  { day: '2026-01-06', value: 20, total: 200 }, // Tue, same week
  { day: '2026-01-12', value: 30, total: 300 }, // Mon, next week
  { day: '2026-02-02', value: 40, total: 400 }, // next month
]

describe('aggregateByPeriod', () => {
  it('passes transactional data through unchanged', () => {
    expect(aggregateByPeriod(rows, 'day', 'transactional', [{ key: 'value', agg: 'avg' }])).toBe(rows)
  })

  it('buckets daily as a 1:1 passthrough by date', () => {
    const out = aggregateByPeriod(rows, 'day', 'daily', [{ key: 'value', agg: 'avg' }])
    expect(out.map(r => r.day)).toEqual(['2026-01-05', '2026-01-06', '2026-01-12', '2026-02-02'])
    expect(out.map(r => r.value)).toEqual([10, 20, 30, 40])
  })

  it('buckets weekly (ISO week, Monday start) with avg and sum aggregators', () => {
    const out = aggregateByPeriod(rows, 'day', 'weekly', [
      { key: 'value', agg: 'avg' },
      { key: 'total', agg: 'sum' },
    ])
    expect(out).toHaveLength(3)
    expect(out[0].day).toBe('2026-01-05')
    expect(out[0].value).toBe(15) // avg(10, 20)
    expect(out[0].total).toBe(300) // sum(100, 200)
    expect(out[1].day).toBe('2026-01-12')
    expect(out[1].value).toBe(30)
    expect(out[2].day).toBe('2026-02-02')
  })

  it('buckets monthly, keyed by start-of-month', () => {
    const out = aggregateByPeriod(rows, 'day', 'monthly', [{ key: 'value', agg: 'avg' }])
    expect(out).toHaveLength(2)
    expect(out[0].day).toBe('2026-01-01')
    expect(out[0].value).toBe(20) // avg(10, 20, 30)
    expect(out[1].day).toBe('2026-02-01')
    expect(out[1].value).toBe(40)
  })

  it('returns an empty array unchanged', () => {
    expect(aggregateByPeriod([], 'day', 'weekly', [{ key: 'value', agg: 'avg' }])).toEqual([])
  })

  it('skips null/non-finite values in aggregation rather than treating them as 0', () => {
    const withGaps: Row[] = [
      { day: '2026-01-05', value: 10, total: 100 },
      { day: '2026-01-06', value: null as any, total: 200 },
    ]
    const out = aggregateByPeriod(withGaps, 'day', 'weekly', [{ key: 'value', agg: 'avg' }])
    expect(out[0].value).toBe(10)
  })
})
