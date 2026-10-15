import { useCallback, useEffect, useState } from 'react'
import { clothingAPI } from '../services/api'
import * as types from '../types'

// Weigh-in outfits. Fetched per mount: the list is tiny, and the server seeds
// the starter set (and back-fills history to the default) on first request.
export function useClothingProfiles() {
  const [profiles, setProfiles] = useState<types.ClothingProfile[]>([])
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(() => {
    return clothingAPI.list()
      .then(setProfiles)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => { reload() }, [reload])

  return { profiles, loaded, reload }
}

/** The profile to preselect: the one on the last entry, else the default. */
export function initialClothingId(
  profiles: types.ClothingProfile[],
  lastLog?: types.WeightLog | null,
): number | null {
  const last = lastLog?.clothing_profile_id
  if (last != null && profiles.some(p => p.id === last)) return last
  return profiles.find(p => p.is_default)?.id ?? profiles[0]?.id ?? null
}
