/**
 * Training types, shared by every screen that shows or picks one.
 *
 * The inference mirrors backend/stores/training.go (InferModality /
 * InferKind) so the routine editor can show the same suggestion the server
 * would store if the client sent nothing. Keep the two in step.
 */
import { Dumbbell, Footprints, StretchHorizontal, Shuffle, type LucideIcon } from 'lucide-react'
import type { Exercise, Modality, TrainingKind } from '../types'

export const MODALITIES: Modality[] = ['strength', 'cardio', 'mobility']
export const KINDS: TrainingKind[] = ['strength', 'cardio', 'mobility', 'mixed']

interface KindMeta {
  label: string
  /** Short noun for counts: "3 lift days". */
  noun: string
  icon: LucideIcon
  /** Tailwind text/bg utility stems backed by the theme's semantic tokens. */
  text: string
  bg: string
  /** Soft background + text pair for chips/icon tiles (full literals so
   *  Tailwind's scanner sees them). */
  tint: string
  /** Raw CSS colour for SVG / inline styles. */
  color: string
  blurb: string
}

export const KIND_META: Record<TrainingKind, KindMeta> = {
  strength: {
    label: 'Strength', noun: 'lift', icon: Dumbbell,
    text: 'text-train', bg: 'bg-train', tint: 'bg-train/15 text-train', color: 'rgb(var(--c-train))',
    blurb: 'Lifting and resistance work',
  },
  cardio: {
    label: 'Cardio', noun: 'cardio', icon: Footprints,
    text: 'text-move', bg: 'bg-move', tint: 'bg-move/15 text-move', color: 'rgb(var(--c-move))',
    blurb: 'Walks, runs, rides — watch sessions count automatically',
  },
  mobility: {
    label: 'Mobility', noun: 'stretch', icon: StretchHorizontal,
    text: 'text-mobility', bg: 'bg-mobility', tint: 'bg-mobility/15 text-mobility', color: 'rgb(var(--c-mobility))',
    blurb: 'Stretching, yoga, mobility flows',
  },
  mixed: {
    label: 'Mixed', noun: 'mixed', icon: Shuffle,
    text: 'text-tx-secondary', bg: 'bg-tx-muted', tint: 'bg-surface-overlay text-tx-secondary', color: 'var(--tx-muted)',
    blurb: 'Counts toward each type it contains',
  },
}

/** Same rule as the server's InferModality, for exercises with no modality yet. */
export function inferModality(ex: Pick<Exercise, 'category' | 'source' | 'name'>): Modality {
  const c = (ex.category ?? '').toLowerCase()
  const n = (ex.name ?? '').toLowerCase()
  if (c === 'cardio' || ex.source === 'baseline') return 'cardio'
  if (c === 'stretching' || c === 'flexibility' || c === 'mobility'
    || n.includes('stretch') || n.includes('yoga') || n.includes(' pose')
    || n.includes('mobility') || n.includes('foam roll')) return 'mobility'
  return 'strength'
}

export const modalityOf = (ex: Exercise): Modality => ex.modality ?? inferModality(ex)

/**
 * Same rule as the server's InferKind: a ≥60% majority names it, flatter is
 * mixed, nothing at all is strength. Counts distinct exercises, like the server.
 */
export function suggestKind(exercises: (Exercise | undefined)[]): TrainingKind {
  const seen = new Set<number>()
  const counts: Record<Modality, number> = { strength: 0, cardio: 0, mobility: 0 }
  for (const ex of exercises) {
    if (!ex || seen.has(ex.id)) continue
    seen.add(ex.id)
    counts[modalityOf(ex)]++
  }
  const total = counts.strength + counts.cardio + counts.mobility
  if (total === 0) return 'strength'
  let top: Modality = 'strength'
  for (const m of MODALITIES) if (counts[m] > counts[top]) top = m
  return counts[top] / total >= 0.6 ? top : 'mixed'
}

/** The types a session counts toward: its own, or for mixed, those its exercises span. */
export function kindsOf(kind: TrainingKind | undefined, exercises: (Exercise | undefined)[] = []): Modality[] {
  const k = kind ?? suggestKind(exercises)
  if (k !== 'mixed') return [k]
  const present = new Set(exercises.filter(Boolean).map(e => modalityOf(e!)))
  const out = MODALITIES.filter(m => present.has(m))
  return out.length ? out : ['strength']
}
