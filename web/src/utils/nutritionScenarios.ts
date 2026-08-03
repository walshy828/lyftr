/**
 * Macro arithmetic for the plan-review "what if I can't hit these numbers"
 * table.
 *
 * This lives on the client rather than the server because it has to recompute
 * as the user edits the draft targets — the deterministic energy basis behind
 * the plan (maintenance, deficit, recommended bands) comes from the backend,
 * but the consequences of *changing* a target have to follow the keystroke.
 */

/** Calories per gram, the standard Atwater factors the whole app uses. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

/** Energy in a pound of body fat — the constant behind every deficit-to-pace
 *  conversion. Mirrors utils.CaloriesPerLb on the backend. */
export const KCAL_PER_LB = 3500

/** Weekly weight change (lbs) implied by a daily calorie deficit. */
export function weeklyLossFromDeficit(dailyDeficit: number): number {
  return (dailyDeficit * 7) / KCAL_PER_LB
}

export interface MacroTargets {
  calories: number
  protein: number
  carbs: number
  fat: number
}

/** Calories the macro grams actually add up to, which drifts from the stated
 *  calorie target by a few percent in most AI-generated plans. */
export function caloriesFromMacros(t: Omit<MacroTargets, 'calories'>): number {
  return t.protein * KCAL_PER_G.protein + t.carbs * KCAL_PER_G.carbs + t.fat * KCAL_PER_G.fat
}

/** Each macro's share of the calories its own grams represent. */
export function macroSplit(t: Omit<MacroTargets, 'calories'>): { protein: number; carbs: number; fat: number } {
  const total = caloriesFromMacros(t)
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 }
  return {
    protein: (t.protein * KCAL_PER_G.protein) / total,
    carbs: (t.carbs * KCAL_PER_G.carbs) / total,
    fat: (t.fat * KCAL_PER_G.fat) / total,
  }
}

export interface ProteinScenario {
  /** Fraction of the recommended protein target this row assumes, e.g. 0.8. */
  adherence: number
  protein: number
  carbs: number
  fat: number
  /** Calories the adjusted grams add up to — held at the original total, so
   *  this stays within rounding distance of the base plan. */
  calories: number
  /** True when this row's protein lands under the point where cutting it
   *  starts costing lean mass (the basis's protein floor). */
  belowProteinFloor: boolean
}

/**
 * Rebalances a plan for a user who will realistically only hit `adherence` of
 * the protein target — the common case where the recommended protein is more
 * than someone wants to eat.
 *
 * Calories are held constant and the freed (or borrowed) protein calories are
 * moved into carbs and fat in proportion to their existing calorie split, so
 * the result is the same energy budget with a different shape rather than an
 * accidental extra deficit. Nudging protein down and leaving everything else
 * alone would quietly turn an 1,800 kcal plan into a 1,650 kcal one, which is
 * exactly the decision the user is trying to make consciously.
 */
export function proteinScenario(base: Omit<MacroTargets, 'calories'>, adherence: number, proteinFloorGrams = 0): ProteinScenario {
  const baseCalories = caloriesFromMacros(base)
  const protein = Math.round(base.protein * adherence)
  const freed = (base.protein - protein) * KCAL_PER_G.protein

  // Split the freed calories by the carb/fat balance already in the plan. If
  // neither has any calories to weight by, everything goes to carbs — a plan
  // that's pure protein isn't a real case, but it shouldn't produce NaN.
  const carbKcal = base.carbs * KCAL_PER_G.carbs
  const fatKcal = base.fat * KCAL_PER_G.fat
  const denom = carbKcal + fatKcal
  const carbShare = denom > 0 ? carbKcal / denom : 1

  const carbs = Math.max(0, Math.round((carbKcal + freed * carbShare) / KCAL_PER_G.carbs))
  const fat = Math.max(0, Math.round((fatKcal + freed * (1 - carbShare)) / KCAL_PER_G.fat))

  return {
    adherence,
    protein,
    carbs,
    fat,
    calories: Math.round(baseCalories),
    belowProteinFloor: proteinFloorGrams > 0 && protein < proteinFloorGrams,
  }
}

/**
 * Grams of carbohydrate left once protein and fat are paid for out of a
 * calorie target. Carbs get no recommended band of their own — they're the
 * remainder, which is why the backend doesn't return one.
 */
export function carbRemainder(calorieTarget: number, proteinGrams: number, fatGrams: number): number {
  const left = calorieTarget - proteinGrams * KCAL_PER_G.protein - fatGrams * KCAL_PER_G.fat
  return Math.max(0, Math.round(left / KCAL_PER_G.carbs))
}
