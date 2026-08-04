/**
 * Client-side matching for the user's own foods (Recent + My Foods).
 *
 * These lists are already in memory, so filtering them is instant and needs no
 * request — the search box can narrow them while the food-database call is
 * still in flight.
 */

/**
 * Lowercase, whitespace-collapsed, trimmed — the twin of the backend's
 * `normalizeFoodName` (controllers/food_portions.go) and the SQL `foodNameKey`
 * used to group the Recent list. Keeping the three in step means a food deduped
 * here matches the same food grouped server-side.
 */
export function normalizeFoodName(s: string | undefined): string {
  return (s ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

interface Matchable {
  name: string
  brand?: string
}

/**
 * Ranks how directly a food answers a query: 0 exact name, 1 name prefix,
 * 2 name substring, 3 brand match, or -1 for no match at all.
 *
 * Every query token must appear somewhere in the name or brand, so "peanut
 * butter" doesn't match a plain "butter".
 */
export function scoreFoodMatch(item: Matchable, query: string): number {
  const q = normalizeFoodName(query)
  if (!q) return 0

  const name = normalizeFoodName(item.name)
  const brand = normalizeFoodName(item.brand)
  const haystack = brand ? `${name} ${brand}` : name

  const tokens = q.split(' ')
  if (!tokens.every(token => haystack.includes(token))) return -1

  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.includes(q)) return 2
  return 3
}

/** Filters and ranks a list of foods against a query, preserving input order within a rank. */
export function filterFoods<T extends Matchable>(items: T[], query: string): T[] {
  if (!query.trim()) return items
  return items
    .map((item, index) => ({ item, index, score: scoreFoodMatch(item, query) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(entry => entry.item)
}
