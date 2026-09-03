import { format, parseISO, startOfWeek, startOfMonth } from 'date-fns'

export type Granularity = 'transactional' | 'daily' | 'weekly' | 'monthly'
export type Aggregator = 'avg' | 'sum' | 'min' | 'max' | 'last'

export interface AggregateField<T> {
  key: keyof T
  agg: Aggregator
}

function bucketKey(dateStr: string, granularity: Granularity): string {
  const d = parseISO(dateStr)
  if (granularity === 'weekly') return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  if (granularity === 'monthly') return format(startOfMonth(d), 'yyyy-MM-dd')
  return format(d, 'yyyy-MM-dd')
}

function reduce(values: number[], agg: Aggregator): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (nums.length === 0) return null
  switch (agg) {
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'sum': return nums.reduce((a, b) => a + b, 0)
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
    case 'last': return nums[nums.length - 1]
  }
}

/**
 * Re-buckets chronological (oldest → newest) rows into daily/weekly/monthly
 * groups, aggregating each named field with its own aggregator. `transactional`
 * is a passthrough — the caller's data is already at its finest granularity.
 * Rows missing a field are skipped for that field's aggregation, not treated as 0.
 */
export function aggregateByPeriod<T extends Record<string, any>>(
  data: T[],
  dateKey: keyof T,
  granularity: Granularity,
  fields: AggregateField<T>[],
): T[] {
  if (granularity === 'transactional' || data.length === 0) return data

  const buckets = new Map<string, T[]>()
  for (const row of data) {
    const key = bucketKey(String(row[dateKey]), granularity)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const out: Record<string, any> = { ...rows[rows.length - 1], [dateKey]: key }
      for (const f of fields) {
        out[f.key as string] = reduce(rows.map(r => r[f.key] as number), f.agg)
      }
      return out as T
    })
}
