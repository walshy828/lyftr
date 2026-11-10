import { describe, it, expect } from 'vitest'
import { buildBalance, balanceInsight } from './TrainingBalanceCard'
import type { TrainingGoal, TrainingTypeDay } from '../../types'

// Wednesday 2026-11-11; this week starts Mon 2026-11-09.
const NOW = new Date(2026, 10, 11, 10)
const GOALS: TrainingGoal[] = [
  { kind: 'strength', days_per_week: 3, minutes_per_week: 0 },
  { kind: 'cardio', days_per_week: 0, minutes_per_week: 150 },
  { kind: 'mobility', days_per_week: 2, minutes_per_week: 0 },
]
const td = (date: string, s: number, cMin: number, m: number): TrainingTypeDay => ({
  date,
  strength: { sessions: s, minutes: s * 60 },
  cardio: { sessions: cMin ? 1 : 0, minutes: cMin },
  mobility: { sessions: m, minutes: m * 10 },
})

describe('buildBalance', () => {
  // Last full week (Nov 2–8): 3 lift days, 160 cardio min, 1 stretch day.
  const days = [
    td('2026-11-02', 1, 40, 1), td('2026-11-04', 1, 40, 0), td('2026-11-06', 1, 40, 0), td('2026-11-07', 0, 40, 0),
  ]
  const rows = buildBalance(NOW, days, GOALS, 2)

  it('scores each week per type against its goal', () => {
    const [s, c, m] = rows
    expect(s.weeks.map(w => w.met)).toEqual([true, false])
    expect(c.weeks[0].done.minutes).toBe(160)
    expect(c.met).toBe(1)
    expect(m.weeks[0].label).toBe('1/2 days')
    expect(m.met).toBe(0)
  })

  it('names the strongest and the slipping type, ignoring the unfinished week', () => {
    expect(balanceInsight(rows)).toBe('Strength is your strongest (1 of 1 weeks met); mobility is the one slipping (0 of 1).')
  })
})
