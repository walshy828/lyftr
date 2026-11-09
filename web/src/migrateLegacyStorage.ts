// One-time migration of localStorage keys from the pre-rename "lyftr_" prefix to
// "baseline_". Must be imported before any store module that reads storage.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('lyftr_')) continue
    const next = 'baseline_' + key.slice('lyftr_'.length)
    if (localStorage.getItem(next) === null) {
      localStorage.setItem(next, localStorage.getItem(key) as string)
    }
    localStorage.removeItem(key)
  }
} catch {
  // storage unavailable (private mode etc.) — nothing to migrate
}
