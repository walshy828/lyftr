import * as types from '../types'

/**
 * Where a food's numbers came from, and how much they can be trusted.
 *
 * The distinction that matters isn't really the source — it's whether someone
 * transcribed an actual Nutrition Facts panel or a model estimated it. A USDA
 * Branded record and an AI guess both produce a calorie count; only one of them
 * matches the box. Surfacing that difference is the point of the badge, so a
 * per-100g USDA row is labelled honestly rather than borrowing the authority of
 * a real label.
 */
export type FoodSourceTone = 'verified' | 'neutral' | 'estimate'

export interface FoodSourceBadge {
  label: string
  tone: FoodSourceTone
  /** Longer form for the detail sheet, where there's room to explain. */
  detail: string
}

type SourceLike = Pick<types.FoodSearchResult, 'source' | 'label_accurate'>

export function foodSourceBadge(item: SourceLike): FoodSourceBadge | null {
  const verified = item.label_accurate === true

  switch (item.source) {
    case 'fdc':
      return verified
        ? { label: 'USDA label', tone: 'verified', detail: 'USDA FoodData Central — manufacturer label' }
        : { label: 'USDA', tone: 'neutral', detail: 'USDA FoodData Central — per 100g reference values' }
    case 'off':
      return verified
        ? { label: 'Label', tone: 'verified', detail: 'Open Food Facts — per-serving label values' }
        : { label: 'Open Food Facts', tone: 'neutral', detail: 'Open Food Facts — per 100g values' }
    case 'ai':
      return { label: 'AI estimate', tone: 'estimate', detail: 'Estimated by AI from your description' }
    case 'photo':
      return { label: 'AI estimate', tone: 'estimate', detail: 'Estimated by AI from a meal photo' }
    case 'manual':
      return { label: 'Manual', tone: 'neutral', detail: 'Entered by hand' }
    // "saved" just means it came out of My Foods; the badge would say nothing
    // about accuracy, since the underlying numbers could have any origin.
    default:
      return null
  }
}

export const FOOD_SOURCE_TONE_CLASS: Record<FoodSourceTone, string> = {
  verified: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  neutral: 'bg-surface-muted text-tx-muted border-surface-border',
  estimate: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
}
