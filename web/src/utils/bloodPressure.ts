import type { BPCategory } from '../types'

// Client mirror of backend/utils/bloodpressure.go's ClassifyBP.
//
// This exists only so the entry sheet can show a category the instant someone
// types a reading, with no round-trip. Every category the app *stores* or
// reasons about still comes from the server — the `category` field on every
// reading is stamped there. If the two ever disagree, the server wins, and
// utils/bloodPressure.test.ts asserts they agree at every threshold.
export function classifyBP(sys: number, dia: number): BPCategory {
  if (sys > 180 || dia > 120) return 'crisis'
  if (sys >= 140 || dia >= 90) return 'stage2'
  // The "or" rule: either number qualifies, so 120/80 is stage 1, not elevated.
  if (sys >= 130 || dia >= 80) return 'stage1'
  if (sys >= 120) return 'elevated'
  if (sys < 90 || dia < 60) return 'low'
  return 'normal'
}

export interface BPCategoryMeta {
  label: string
  /** One line on what this category means, in plain language. */
  blurb: string
  /** Tailwind classes for a chip/badge. */
  chip: string
  /** Hex, for chart bands and gauges (recharts can't take Tailwind classes). */
  hex: string
}

export const BP_CATEGORIES: Record<BPCategory, BPCategoryMeta> = {
  low: {
    label: 'Low',
    blurb: 'Below the typical range. Not necessarily a problem on its own, but worth mentioning to a doctor if you feel dizzy or faint.',
    chip: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    hex: '#0ea5e9',
  },
  normal: {
    label: 'Normal',
    blurb: 'Under 120/80. This is the range to aim for.',
    chip: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    hex: '#10b981',
  },
  elevated: {
    label: 'Elevated',
    blurb: '120-129 over under 80. Not high blood pressure yet, but likely to become it without a change.',
    chip: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    hex: '#f59e0b',
  },
  stage1: {
    label: 'Stage 1',
    blurb: '130-139 or 80-89. In the stage 1 hypertension range — worth raising with a doctor.',
    chip: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    hex: '#f97316',
  },
  stage2: {
    label: 'Stage 2',
    blurb: '140 or higher, or 90 or higher. In the stage 2 hypertension range — this one warrants a conversation with a doctor.',
    chip: 'bg-red-500/10 text-red-400 border-red-500/20',
    hex: '#ef4444',
  },
  crisis: {
    label: 'Crisis',
    blurb: 'Above 180/120. Rest five minutes and measure again; if it stays this high, seek medical care.',
    chip: 'bg-red-600/20 text-red-300 border-red-600/40',
    hex: '#b91c1c',
  },
}

/**
 * The wording shown when a reading lands in the crisis range. Deliberately kept
 * in one place: it appears at entry time and on the hub, and the two must not
 * drift apart. Nothing here depends on an AI provider.
 */
export const BP_CRISIS_WARNING =
  'A reading above 180/120 is a hypertensive crisis. If you also have chest pain, shortness of breath, weakness, trouble speaking, or vision changes, call emergency services now. Otherwise rest five minutes and measure again — if it is still this high, contact a doctor today.'

/** Formats a reading the way it is universally written. */
export function formatBP(sys: number, dia: number): string {
  return `${Math.round(sys)}/${Math.round(dia)}`
}

export const BP_CONTEXTS = [
  { value: 'morning', label: 'Morning' },
  { value: 'evening', label: 'Evening' },
  { value: 'post_workout', label: 'Post-workout' },
  { value: 'other', label: 'Other' },
] as const
