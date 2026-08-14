import { apiAssetUrl } from '../services/api'
import * as types from '../types'

export type Frame = 'start' | 'end'

type MediaExercise = Pick<types.Exercise, 'id' | 'image_url' | 'image_url_end' | 'source_id'>

/**
 * Where to load an exercise's movement frame from.
 *
 * The local cache is an OPTIMISATION, not a requirement. It can only serve an
 * exercise once `source_id` is populated, and that column only fills in when an
 * admin exercise sync runs — so on any library seeded before the column
 * existed, every cached URL 404s. Treating the cache as the only source turned
 * a working image into a placeholder icon on every existing install.
 *
 * So: prefer the cache when the row can actually be served from it, and always
 * keep the upstream URL as a fallback for `onError`.
 *
 * Returns [] when the exercise has no artwork at all.
 */
export function exerciseImageSources(exercise: MediaExercise, frame: Frame): string[] {
  const stored = frame === 'end' ? exercise.image_url_end : exercise.image_url
  const sources: string[] = []
  // Only route through the cache for the frames it can actually produce: the
  // endpoint derives both from source_id, so asking for an end frame the row
  // doesn't have is a guaranteed 404 and a wasted request.
  if (exercise.source_id && (frame === 'start' || exercise.image_url_end)) {
    sources.push(apiAssetUrl(`/exercises/${exercise.id}/image/${frame}`))
  }
  if (stored) sources.push(stored)
  return sources
}

/** True when this exercise has any artwork for the frame, cached or upstream. */
export function hasExerciseImage(exercise: MediaExercise, frame: Frame): boolean {
  return exerciseImageSources(exercise, frame).length > 0
}

type GifExercise = Pick<types.Exercise, 'id' | 'gif_url' | 'source_id'>

/**
 * Where to load an exercise's real animated GIF from (only present on
 * libraries seeded with EXERCISE_GIF_SOURCE — see backend/config.go).
 *
 * Same cache-then-upstream fallback chain as exerciseImageSources: the local
 * cache endpoint can only serve it once source_id is populated, so the
 * stored gif_url is always kept as a fallback for onError.
 */
export function exerciseGifSources(exercise: GifExercise): string[] {
  if (!exercise.gif_url) return []
  const sources: string[] = []
  if (exercise.source_id) sources.push(apiAssetUrl(`/exercises/${exercise.id}/image/gif`))
  sources.push(exercise.gif_url)
  return sources
}
