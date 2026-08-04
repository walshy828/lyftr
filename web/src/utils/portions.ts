import type { FoodSearchResult } from '../types'

/**
 * Portion math for the food logger.
 *
 * Food databases quote nutrition against a mass basis — usually 100 g. Logging
 * a condiment against that basis is unusable: 1 tbsp of mayo is 0.14 of a 100 g
 * "serving", which a 0.5-step multiplier can't even express. These helpers turn
 * the gram basis into an amount + unit the user actually thinks in, and convert
 * back to the `servings` multiplier the API already stores.
 *
 * Deliberately absent: any built-in volume-to-mass table. tsp/tbsp/cup only
 * appear as units when the food's source published the gram weight, because
 * the conversion is density-dependent — a guessed 1 tbsp would silently scale
 * every macro shown afterwards.
 */

export interface UnitOption {
  /** Stable identity for selection state. */
  id: string
  label: string
  /** Mass of one of this unit, in grams. */
  grams: number
}

const GRAMS_PER_OZ = 28.349523125

/** The unit id used when a food has no gram basis and only servings apply. */
export const SERVING_UNIT_ID = 'serving'

/**
 * Builds the unit list offered for a food.
 *
 * Always includes the food's own serving. When the gram basis is known it adds
 * the exact mass units (g, oz) plus every household measure the source
 * published. When it isn't, the serving is the only option and the caller
 * falls back to a plain servings multiplier.
 */
export function buildUnitOptions(result: Pick<FoodSearchResult, 'serving_size' | 'serving_size_grams' | 'portions'>): UnitOption[] {
  const basis = result.serving_size_grams ?? 0
  const servingLabel = result.serving_size?.trim() || '1 serving'
  const serving: UnitOption = { id: SERVING_UNIT_ID, label: servingLabel, grams: basis }

  if (basis <= 0) return [serving]

  const options: UnitOption[] = [serving, { id: 'g', label: 'g', grams: 1 }, { id: 'oz', label: 'oz', grams: GRAMS_PER_OZ }]

  const seen = new Set(options.map(o => o.label.toLowerCase()))
  for (const portion of result.portions ?? []) {
    const label = portion.label?.trim()
    if (!label || portion.grams <= 0 || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    options.push({ id: `portion:${label}`, grams: portion.grams, label })
  }
  return options
}

/** Looks up a unit by id, falling back to the serving unit. */
export function findUnit(options: UnitOption[], unitId: string): UnitOption {
  return options.find(o => o.id === unitId) ?? options[0]
}

/**
 * Converts an amount in the chosen unit to the `servings` multiplier the API
 * stores — i.e. how many gram-bases the user is eating.
 *
 * With no gram basis the amount *is* the multiplier, which keeps the old
 * servings-stepper behaviour intact for foods we can't measure by mass.
 */
export function amountToServings(amount: number, unit: UnitOption, servingSizeGrams: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (servingSizeGrams <= 0 || unit.grams <= 0) return amount
  return (amount * unit.grams) / servingSizeGrams
}

/** Total mass of the chosen amount, in grams. 0 when the basis is unknown. */
export function amountToGrams(amount: number, unit: UnitOption): number {
  if (!Number.isFinite(amount) || amount <= 0 || unit.grams <= 0) return 0
  return amount * unit.grams
}

/**
 * The "1 tbsp = 14 g" line under the picker — shown only for units whose mass
 * isn't already self-evident from the unit itself.
 */
export function formatUnitHint(unit: UnitOption): string {
  if (unit.grams <= 0 || unit.id === 'g') return ''
  // Keep a decimal when there is one: 13.8 g rounded to 14 g would misstate the
  // very conversion this line exists to make explicit.
  const grams = Number.isInteger(unit.grams) ? unit.grams.toString() : unit.grams.toFixed(1)
  // Portion labels already carry their own quantity ("1 tbsp"); only bare mass
  // units need one prefixed.
  const name = unit.id === 'oz' ? `1 ${unit.label}` : unit.label
  return `${name} = ${grams} g`
}

/**
 * The label persisted on the food log, e.g. "1 tbsp (14 g)". Read back later by
 * Recent rows and by the edit view, so it has to stand alone as a description
 * of what was eaten.
 */
export function formatServingLabel(amount: number, unit: UnitOption): string {
  const qty = Number.isInteger(amount) ? amount.toString() : amount.toString()
  if (unit.id === SERVING_UNIT_ID) return unit.label
  if (unit.id === 'g' || unit.id === 'oz') return `${qty} ${unit.label}`
  const grams = amountToGrams(amount, unit)
  return grams > 0 ? `${qty} × ${unit.label} (${Math.round(grams)} g)` : `${qty} × ${unit.label}`
}

/**
 * Chooses the unit to open the picker on for a logged entry being re-opened.
 * Prefers the unit whose label the entry was saved with, so editing "1 tbsp"
 * doesn't silently reopen as "14 g".
 */
export function matchUnitForLabel(options: UnitOption[], label?: string): UnitOption {
  const target = label?.trim().toLowerCase()
  if (!target) return options[0]

  // Household measures first, longest label first: "1 × 1 tbsp (14 g)" names a
  // tbsp, and a naive substring scan would otherwise match the bare "g" first.
  const portions = options
    .filter(o => o.id.startsWith('portion:'))
    .sort((a, b) => b.label.length - a.label.length)
  const portionHit = portions.find(o => target.includes(o.label.toLowerCase()))
  if (portionHit) return portionHit

  // Mass units need a number in front of them and a word boundary after, so
  // "per 100g" (a basis label, not an amount the user chose) doesn't read as
  // grams while "30 g" does.
  for (const id of ['g', 'oz'] as const) {
    const unit = options.find(o => o.id === id)
    if (unit && new RegExp(`^\\d+(\\.\\d+)?\\s*${id}\\b`).test(target)) return unit
  }

  return options[0]
}
