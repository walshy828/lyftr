import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../services/api', () => ({
  userAPI: { getSettings: vi.fn(), updateSettings: vi.fn() },
}))

const KEY = 'lyftr_food_search_sources'

// The store reads localStorage at module load via clientPrefs(), so each case
// seeds storage and then re-imports it fresh.
async function loadStore(seed?: string) {
  localStorage.clear()
  if (seed !== undefined) localStorage.setItem(KEY, seed)
  vi.resetModules()
  return (await import('./settings')).useSettingsStore
}

describe('food_search_sources persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to every source when nothing is stored', async () => {
    const store = await loadStore()
    expect(store.getState().settings.food_search_sources).toEqual(['off', 'fdc'])
  })

  it('restores a narrowed selection across a reload', async () => {
    const store = await loadStore(JSON.stringify(['fdc']))
    expect(store.getState().settings.food_search_sources).toEqual(['fdc'])
  })

  it('persists a selection to localStorage', async () => {
    const store = await loadStore()
    store.getState().setFoodSearchSources(['fdc'])

    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(['fdc'])
    expect(store.getState().settings.food_search_sources).toEqual(['fdc'])
  })

  it('refuses to persist an empty selection', async () => {
    // A stored empty list would come back as a search that queries nothing and
    // returns nothing, which reads as "your food doesn't exist".
    const store = await loadStore()
    store.getState().setFoodSearchSources([])

    expect(store.getState().settings.food_search_sources).toEqual(['off', 'fdc'])
  })

  it('falls back to all sources when the stored value is unusable', async () => {
    for (const junk of ['[]', 'not json', '{"a":1}', '["bogus"]', 'null']) {
      const store = await loadStore(junk)
      expect(store.getState().settings.food_search_sources).toEqual(['off', 'fdc'])
    }
  })

  it('drops unknown sources but keeps the valid ones', async () => {
    const store = await loadStore(JSON.stringify(['fdc', 'bogus']))
    expect(store.getState().settings.food_search_sources).toEqual(['fdc'])
  })
})
