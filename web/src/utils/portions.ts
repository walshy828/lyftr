import type { FoodSearchResult } from '../types'

/**
 * Portion math for the food logger.
 *
 * Food databases quote nutrition against a basis — usually 100 g, sometimes a
 * label serving, and for drinks a volume. Logging a condiment against that
 * basis is unusable: 1 tbsp of mayo is 0.14 of a 100 g "serving", which a
 * 0.5-step multiplier can't even express. These helpers turn the basis into an
 * amount + unit the user actually thinks in — g, oz, tsp, tbsp, cup, fl oz, ml
 * — and convert back to the `servings` multiplier the API already stores.
 *
 * Crossing between mass and volume needs a density. Three cases, in order of
 * preference:
 *
 *   1. The food states both bases ("30 g (2 tbsp)", or a USDA measure whose
 *      label names a volume and whose gram weight is published) — exact.
 *   2. The food states one basis and the unit is in that same dimension
 *      (ml → cup, g → oz) — exact, no density involved.
 *   3. Neither: fall back to water, 1 g/ml. Every such unit is marked
 *      `estimated` and the UI says so, because it is a real approximation —
 *      a cup of flour is ~125 g, not 240 g.
 */

export interface UnitOption {
  /** Stable identity for selection state. */
  id: string
  label: string
  /** Mass of one of this unit, in grams. 0 when unknown. */
  grams: number
  /** Volume of one of this unit, in millilitres, for units that name one. */
  ml?: number
  /**
   * True when converting this unit to servings — and so every macro on screen —
   * goes through an assumed density. A cup of a food quoted per 100 g is
   * estimated; a cup of a drink quoted per 240 ml is not, because volume
   * divides into volume exactly.
   */
  estimated?: boolean
  /**
   * True when this unit's `grams` rests on an assumed density, which is a
   * narrower claim: a cup of that same drink converts exactly but still has no
   * known weight. Keeps an estimate from being displayed, or stored, as fact.
   */
  gramsEstimated?: boolean
}

/**
 * What one basis of this food is, in both dimensions. Either may be 0 for
 * "unknown"; both 0 means nothing can be converted and the amount is simply the
 * servings multiplier.
 */
export interface PortionBasis {
  grams: number
  ml: number
  /** True when the cross-dimension half of this basis was assumed, not stated. */
  estimated: boolean
}

const GRAMS_PER_OZ = 28.349523125

/** The unit id used when a food has no measurable basis and only servings apply. */
export const SERVING_UNIT_ID = 'serving'

/**
 * The volume ladder, in millilitres.
 *
 * These are the FDA labelling conventions (tsp 5, tbsp 15, fl oz 30, cup 240),
 * not the US customary ones (4.93 / 14.79 / 29.57 / 236.6), and they match the
 * backend's `volumeToML`. Nutrition Facts panels are printed against the
 * rounded figures, so a serving stated as "1 cup (240 ml)" only adds up under
 * them.
 */
const VOLUME_UNITS: { id: string; label: string; ml: number }[] = [
  { id: 'tsp', label: 'tsp', ml: 5 },
  { id: 'tbsp', label: 'tbsp', ml: 15 },
  { id: 'floz', label: 'fl oz', ml: 30 },
  { id: 'cup', label: 'cup', ml: 240 },
  { id: 'ml', label: 'ml', ml: 1 },
]

type FoodLike = Pick<FoodSearchResult, 'serving_size' | 'serving_size_grams' | 'portions'> & {
  serving_size_ml?: number
}

/**
 * This food's density in g/ml, and whether it was published or assumed.
 *
 * A published density comes from any single measurement that states both
 * dimensions — the food's own basis, or one of its portions ("1 cup", 226 g).
 * Portions are searched longest-volume-first only in the sense that any of them
 * will do: they're all the same food, so any pair yields the same density.
 */
function deriveDensity(result: FoodLike): { gPerMl: number; estimated: boolean } {
  const basisG = result.serving_size_grams ?? 0
  const basisML = result.serving_size_ml ?? 0
  if (basisG > 0 && basisML > 0) return { gPerMl: basisG / basisML, estimated: false }

  for (const portion of result.portions ?? []) {
    if (portion.grams > 0 && (portion.ml ?? 0) > 0) {
      return { gPerMl: portion.grams / (portion.ml as number), estimated: false }
    }
  }

  // Water. Right for drinks, roughly right for most liquids, and wrong by up to
  // 2× for dry goods — hence the flag, which the picker surfaces.
  return { gPerMl: 1, estimated: true }
}

/**
 * The basis the quoted nutrition numbers describe, filled out across both
 * dimensions using the food's density where one is needed.
 *
 * `amountToServings` divides by this, so it is the number every macro on screen
 * ultimately rests on.
 */
export function portionBasis(result: FoodLike): PortionBasis {
  const grams = result.serving_size_grams ?? 0
  const ml = result.serving_size_ml ?? 0
  if (grams > 0 && ml > 0) return { grams, ml, estimated: false }
  if (grams <= 0 && ml <= 0) return { grams: 0, ml: 0, estimated: false }

  const { gPerMl, estimated } = deriveDensity(result)
  return grams > 0
    ? { grams, ml: grams / gPerMl, estimated }
    : { grams: ml * gPerMl, ml, estimated }
}

/**
 * Builds the unit list offered for a food.
 *
 * Always includes the food's own serving. When the food has any measurable
 * basis it adds the mass units (g, oz), the volume ladder (tsp, tbsp, fl oz,
 * cup, ml), and every household measure the source published. Units that had to
 * cross dimensions on an assumed density carry `estimated`.
 *
 * With no basis at all the serving is the only option and the caller falls back
 * to a plain servings multiplier.
 */
export function buildUnitOptions(result: FoodLike): UnitOption[] {
  const basisG = result.serving_size_grams ?? 0
  const basisML = result.serving_size_ml ?? 0
  const servingLabel = result.serving_size?.trim() || '1 serving'
  const serving: UnitOption = {
    id: SERVING_UNIT_ID,
    label: servingLabel,
    grams: basisG,
    ml: basisML || undefined,
  }

  if (basisG <= 0 && basisML <= 0) return [serving]

  const { gPerMl, estimated } = deriveDensity(result)

  // A mass unit is exact for a food weighed in grams; for one measured in ml it
  // rests on the density, exact or otherwise.
  const massEstimated = basisG > 0 ? false : estimated
  // A volume unit is the mirror image: exact for a food stated in ml.
  const volumeEstimated = basisML > 0 ? false : estimated

  const options: UnitOption[] = [
    serving,
    // A gram weighs a gram whatever the food, so the mass units never carry a
    // gram estimate — only their route back to a volume-based serving can be
    // approximate.
    { id: 'g', label: 'g', grams: 1, ml: 1 / gPerMl, estimated: massEstimated },
    { id: 'oz', label: 'oz', grams: GRAMS_PER_OZ, ml: GRAMS_PER_OZ / gPerMl, estimated: massEstimated },
    ...VOLUME_UNITS.map(u => ({
      id: u.id,
      label: u.label,
      grams: u.ml * gPerMl,
      ml: u.ml,
      estimated: volumeEstimated,
      gramsEstimated: estimated,
    })),
  ]

  const seen = new Set(options.map(o => o.label.toLowerCase()))
  for (const portion of result.portions ?? []) {
    const label = portion.label?.trim()
    if (!label || portion.grams <= 0 || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    options.push({ id: `portion:${label}`, grams: portion.grams, ml: portion.ml || undefined, label })
  }
  return options
}

/** Looks up a unit by id, falling back to the serving unit. */
export function findUnit(options: UnitOption[], unitId: string): UnitOption {
  return options.find(o => o.id === unitId) ?? options[0]
}

/**
 * Converts an amount in the chosen unit to the `servings` multiplier the API
 * stores — i.e. how many bases the user is eating.
 *
 * Volume is matched against volume and mass against mass wherever both sides
 * offer it, so a drink logged in cups never routes through a density at all.
 *
 * With no basis the amount *is* the multiplier, which keeps the old
 * servings-stepper behaviour intact for foods we can't measure.
 */
export function amountToServings(amount: number, unit: UnitOption, basis: PortionBasis): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (basis.ml > 0 && (unit.ml ?? 0) > 0) return (amount * (unit.ml as number)) / basis.ml
  if (basis.grams > 0 && unit.grams > 0) return (amount * unit.grams) / basis.grams
  return amount
}

/** Total mass of the chosen amount, in grams. 0 when the mass is unknown. */
export function amountToGrams(amount: number, unit: UnitOption): number {
  if (!Number.isFinite(amount) || amount <= 0 || unit.grams <= 0) return 0
  return amount * unit.grams
}

/**
 * The "1 tbsp = 14 g" line under the picker — shown only for units whose mass
 * isn't already self-evident from the unit itself.
 *
 * An estimated conversion says so. It is the one place the user can see that
 * "1 cup" of a food nobody published a density for is our arithmetic and not
 * the manufacturer's, and every macro on the screen is scaled by it.
 */
export function formatUnitHint(unit: UnitOption): string {
  if (unit.grams <= 0 || unit.id === 'g') return ''
  // Keep a decimal when there is one: 13.8 g rounded to 14 g would misstate the
  // very conversion this line exists to make explicit.
  const grams = Number.isInteger(unit.grams) ? unit.grams.toString() : unit.grams.toFixed(1)
  // Portion labels already carry their own quantity ("1 tbsp"); only bare mass
  // and volume units need one prefixed.
  const name = unit.id.startsWith('portion:') || unit.id === SERVING_UNIT_ID ? unit.label : `1 ${unit.label}`
  return unit.gramsEstimated ? `${name} ≈ ${grams} g (estimated)` : `${name} = ${grams} g`
}

/**
 * The label persisted on the food log, e.g. "1 tbsp (14 g)". Read back later by
 * Recent rows and by the edit view, so it has to stand alone as a description
 * of what was eaten.
 */
export function formatServingLabel(amount: number, unit: UnitOption): string {
  const qty = amount.toString()
  if (unit.id === SERVING_UNIT_ID) return unit.label
  if (unit.id === 'g' || unit.id === 'oz') return `${qty} ${unit.label}`
  // Volume units read naturally with the amount in front — "0.5 cup" — and only
  // quote a gram weight when it's a published fact rather than our estimate.
  if (VOLUME_UNITS.some(v => v.id === unit.id)) {
    const grams = amountToGrams(amount, unit)
    return unit.gramsEstimated || grams <= 0 ? `${qty} ${unit.label}` : `${qty} ${unit.label} (${Math.round(grams)} g)`
  }
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

  // The food's own serving wins an exact match outright. Its label is whatever
  // the entry recorded — "1 tbsp", "cup", "g" — and the serving carries the
  // basis those numbers were stored against, so matching a same-named unit from
  // the generic ladder instead would rescale the entry by a different mass.
  const serving = options.find(o => o.id === SERVING_UNIT_ID)
  if (serving && serving.label.trim().toLowerCase() === target) return serving

  // Household measures next, longest label first: "1 × 1 tbsp (14 g)" names a
  // tbsp, and a naive substring scan would otherwise match the bare "g" first.
  const portions = options
    .filter(o => o.id.startsWith('portion:'))
    .sort((a, b) => b.label.length - a.label.length)
  const portionHit = portions.find(o => target.includes(o.label.toLowerCase()))
  if (portionHit) return portionHit

  // Bare units need a number in front of them and a word boundary after, so
  // "per 100g" (a basis label, not an amount the user chose) doesn't read as
  // grams while "30 g" does. Longest pattern first, or "1 fl oz" matches "oz".
  const bare = ['fl oz', 'tbsp', 'tsp', 'cup', 'ml', 'oz', 'g']
  for (const token of bare) {
    const unit = options.find(o => o.label.toLowerCase() === token)
    if (unit && new RegExp(`^\\d+(\\.\\d+)?\\s*${token}\\b`).test(target)) return unit
  }

  return options[0]
}
