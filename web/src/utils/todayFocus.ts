/**
 * "What do I need to do today?" — the short, ordered checklist at the top of
 * Today. Unlike the weekly insights (dashboardMetrics.buildInsights), every
 * item here is about *today* and most carry an action, so the list doubles as
 * the day's to-do: weigh in, hit protein, do the planned session.
 *
 * Pure so it can be unit-tested against a fixed clock.
 */
import type { DailyStats, ScheduledDay, UserSettings, WeightLog } from '../types'

export type FocusAction = 'weigh' | 'log-food' | 'start-workout'

export interface FocusItem {
  id: string
  tone: 'good' | 'focus' | 'todo'
  title: string
  detail?: string
  action?: FocusAction
  actionLabel?: string
}

export interface TodayFocusInput {
  now: Date
  food: DailyStats
  settings: Pick<UserSettings, 'calorie_target' | 'protein_target'>
  lastWeight: WeightLog | null
  todaysPlan: ScheduledDay | null
  /** Pretty-printed last weight in display units, e.g. "173.1 lb". */
  lastWeightLabel?: string
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * Fraction of the eating day that has passed (7am → 9pm), used to judge
 * whether being 80g short on protein at 10am is a problem (no) or at 8pm (yes).
 */
export function dayProgress(now: Date): number {
  const h = now.getHours() + now.getMinutes() / 60
  return Math.min(1, Math.max(0, (h - 7) / 14))
}

export function buildTodayFocus(i: TodayFocusInput): FocusItem[] {
  const out: FocusItem[] = []
  const progress = dayProgress(i.now)

  // 1. Weigh-in — a morning habit, so it leads until it's done.
  if (!i.lastWeight || !sameDay(new Date(i.lastWeight.logged_at), i.now)) {
    const days = i.lastWeight
      ? Math.round((i.now.getTime() - new Date(i.lastWeight.logged_at).getTime()) / 86_400_000)
      : null
    out.push({
      id: 'weigh', tone: 'todo', title: 'Weigh in',
      detail: days === null ? 'No weigh-ins yet' : days <= 1 ? `Last: ${i.lastWeightLabel ?? ''} yesterday`.trim() : `Last one was ${days} days ago`,
      action: 'weigh', actionLabel: 'Log',
    })
  } else {
    out.push({ id: 'weigh', tone: 'good', title: 'Weighed in', detail: i.lastWeightLabel })
  }

  // 2. The planned session.
  const planned = i.todaysPlan?.programs ?? []
  if (planned.length > 0) {
    const pending = planned.filter(p => !p.completed_workout_id)
    if (pending.length === 0) {
      out.push({ id: 'train', tone: 'good', title: `${planned.map(p => p.name).join(' + ')} done` })
    } else {
      out.push({
        id: 'train', tone: 'todo', title: pending[0].name,
        detail: `${pending[0].exercise_count} exercises planned today`,
        action: 'start-workout', actionLabel: 'Start',
      })
    }
  }

  // 3. Food — nothing logged, or on/off pace for protein and calories.
  const kcal = i.food.total_calories
  const protein = i.food.total_protein
  if (kcal <= 0) {
    if (progress > 0.15) out.push({
      id: 'food', tone: 'todo', title: 'Nothing logged yet today',
      detail: 'Describe or snap your first meal', action: 'log-food', actionLabel: 'Log',
    })
  } else {
    const proteinGap = i.settings.protein_target - protein
    const expected = i.settings.protein_target * progress
    if (proteinGap <= 0) {
      out.push({ id: 'protein', tone: 'good', title: 'Protein target hit', detail: `${Math.round(protein)} g of ${i.settings.protein_target} g` })
    } else if (protein < expected - 20) {
      out.push({
        id: 'protein', tone: 'focus', title: `${Math.round(proteinGap)} g protein to go`,
        detail: progress > 0.6 ? 'Make the next meal protein-forward' : 'Behind pace for this time of day',
      })
    }
    const over = kcal - i.settings.calorie_target
    if (over > 0) {
      out.push({ id: 'kcal', tone: 'focus', title: `${Math.round(over)} kcal over target`, detail: 'Keep the rest of today light' })
    }
  }

  // Actionable first, then focus, then wins — so the eye lands on what's left.
  const rank = { todo: 0, focus: 1, good: 2 } as const
  return out.sort((a, b) => rank[a.tone] - rank[b.tone])
}
