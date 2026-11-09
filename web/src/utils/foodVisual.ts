/**
 * A glanceable visual for any food, even ones with no photo.
 *
 * Most logged foods have no image (AI-described meals, database hits without
 * product shots, manual entries), and a wall of identical fork icons makes a
 * diary unscannable. So every food gets a deterministic stand-in: an emoji
 * picked from keywords in its name, on a tile tinted by its dominant macro.
 * A real photo (saved food, scanned product, meal photo) always wins.
 */

// Ordered: first match wins, so more specific words sit above generic ones
// ("peanut butter" before "butter", "sweet potato" before "potato").
const KEYWORDS: [RegExp, string][] = [
  [/protein shake|whey|shake|smoothie/, '🥤'],
  [/coffee|latte|espresso|cappuccino|americano/, '☕'],
  [/\btea\b|matcha/, '🍵'],
  [/beer|ipa|lager/, '🍺'],
  [/wine/, '🍷'],
  [/soda|cola|ginger ale|sprite|seltzer/, '🥫'],
  [/\bwater\b/, '💧'],
  [/juice/, '🧃'],
  [/milk(?!.*chocolate)/, '🥛'],
  [/peanut butter|almond butter/, '🥜'],
  [/egg|omelet|omelette|frittata/, '🥚'],
  [/bacon/, '🥓'],
  [/sausage|hot dog|bratwurst/, '🌭'],
  [/pancake|waffle|french toast/, '🥞'],
  [/\boats?\b|oatmeal|overnight oats|porridge|granola|cereal|muesli/, '🥣'],
  [/bagel/, '🥯'],
  [/croissant|pastry|danish/, '🥐'],
  [/sandwich|sub\b|wrap|panini|blt/, '🥪'],
  [/burger/, '🍔'],
  [/pizza/, '🍕'],
  [/taco|burrito|quesadilla|nacho/, '🌮'],
  [/sushi|sashimi|poke/, '🍣'],
  [/ramen|pho|noodle|udon/, '🍜'],
  [/pasta|spaghetti|penne|lasagna|mac and cheese|macaroni/, '🍝'],
  [/fried rice|rice bowl|burrito bowl|rice/, '🍚'],
  [/curry/, '🍛'],
  [/soup|stew|chili/, '🍲'],
  [/salad/, '🥗'],
  [/salmon|tuna|cod|tilapia|fish|shrimp|prawn/, '🐟'],
  [/chicken|turkey/, '🍗'],
  [/steak|beef|pork|lamb|brisket|ribs/, '🥩'],
  [/tofu|tempeh/, '🧊'],
  [/sweet potato|yam/, '🍠'],
  [/fries|potato|hash brown/, '🥔'],
  [/bread|toast|baguette|roll\b|bun\b/, '🍞'],
  [/greek yogurt|yogurt|yoghurt|skyr/, '🥛'],
  [/cottage cheese|cheese/, '🧀'],
  [/banana/, '🍌'],
  [/pineapple/, '🍍'],
  [/apple/, '🍎'],
  [/orange|clementine|mandarin/, '🍊'],
  [/strawberr/, '🍓'],
  [/blueberr|berries|berry/, '🫐'],
  [/grape/, '🍇'],
  [/watermelon|melon/, '🍉'],
  [/peach|nectarine/, '🍑'],
  [/avocado|guacamole/, '🥑'],
  [/broccoli|green bean|asparagus|spinach|kale|greens|vegetable|veggie/, '🥦'],
  [/carrot/, '🥕'],
  [/\bcorn\b/, '🌽'],
  [/tomato/, '🍅'],
  [/almond|walnut|cashew|pecan|pistachio|nuts?\b|trail mix/, '🌰'],
  [/protein bar|granola bar|bar\b/, '🍫'],
  [/chocolate|candy|m&m|snickers/, '🍫'],
  [/cookie|biscuit/, '🍪'],
  [/donut|doughnut/, '🍩'],
  [/cake|cupcake|brownie|muffin/, '🧁'],
  [/ice cream|gelato|frozen yogurt/, '🍨'],
  [/popcorn/, '🍿'],
  [/chip|crisp|pretzel|cracker/, '🥨'],
  [/hummus|dip/, '🫘'],
  [/bean|lentil|chickpea/, '🫘'],
]

export type MacroKey = 'protein' | 'carbs' | 'fat'

export interface FoodVisual {
  emoji: string
  /** The macro supplying the most calories — drives the tile tint. */
  dominant: MacroKey | null
}

/**
 * The keyword that appears *earliest* in the name wins, so a composite meal is
 * pictured by its headline food ("Chicken breast with rice" → chicken, not
 * rice). List order only breaks ties at the same position, which is what lets
 * "sweet potato" beat "potato" and "pineapple" beat "apple".
 */
export function foodEmoji(name: string): string {
  const n = name.toLowerCase()
  let best: { at: number; emoji: string } | null = null
  for (const [re, emoji] of KEYWORDS) {
    const m = re.exec(n)
    if (m && (best === null || m.index < best.at)) best = { at: m.index, emoji }
  }
  return best?.emoji ?? '🍽️'
}

export function dominantMacro(m: { protein?: number; carbs?: number; fat?: number }): MacroKey | null {
  const kcal = { protein: (m.protein ?? 0) * 4, carbs: (m.carbs ?? 0) * 4, fat: (m.fat ?? 0) * 9 }
  const total = kcal.protein + kcal.carbs + kcal.fat
  if (total <= 0) return null
  return (Object.entries(kcal).sort((a, b) => b[1] - a[1])[0][0]) as MacroKey
}

export function foodVisual(f: { name: string; protein?: number; carbs?: number; fat?: number }): FoodVisual {
  return { emoji: foodEmoji(f.name), dominant: dominantMacro(f) }
}

/** Time-of-day default meal, so one-tap logging lands where you'd expect. */
export function mealForNow(now = new Date()): 'breakfast' | 'lunch' | 'dinner' | 'snacks' {
  const h = now.getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h >= 17 && h < 21) return 'dinner'
  return 'snacks'
}
