import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, X, Plus, Sparkles } from 'lucide-react'
import { exerciseAPI } from '../services/api'
import ExerciseGrid from '../components/exercise/ExerciseGrid'
import CreateExerciseSheet from '../components/exercise/CreateExerciseSheet'
import AddToRoutineSheet from '../components/AddToRoutineSheet'
import { PageHeader, HScrollTabs } from '../components/ui'
import { BODY_PART_GROUPS, EQUIPMENT_LABEL, bodyPartOf, type BodyPartGroup } from '../utils/exerciseUtils'
import * as types from '../types'

// Alphabetical, matching how ExerciseDB-style browse UIs order body-part
// tabs — "Cardio" isn't a BODY_PART_GROUPS entry (it's driven by category,
// not muscle_group) so it's spliced in here rather than in that shared list.
const PART_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  ...[...BODY_PART_GROUPS, { key: 'cardio', label: 'Cardio', muscleGroups: [] } satisfies BodyPartGroup]
    .sort((a, b) => a.label.localeCompare(b.label)),
]

/**
 * Browse the whole exercise library.
 *
 * openGym-style layout: always-visible body-part and equipment tab rows
 * (each locked to one row — HScrollTabs makes it swipeable on touch and
 * paged with chevrons on desktop) instead of a collapsible filter panel, and
 * a card grid instead of a single-column list. All filtering happens
 * client-side against the full (cached) catalog — ~1300 rows is cheap to
 * filter in JS and this lets body-part tabs use the coarse BODY_PART_GROUPS
 * buckets, which the backend's muscle_group column doesn't natively group by.
 *
 * The page scrolls normally (no inner scroll widget) and ExerciseGrid reveals
 * matches 20 at a time as you scroll toward the bottom, rather than
 * virtualizing a fixed-height container.
 *
 * Selections live in the URL so a filtered view is linkable and survives a
 * back-navigation from an exercise's detail page.
 */
export default function Exercises() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [exercises, setExercises] = useState<types.Exercise[]>([])
  const [equipmentFacet, setEquipmentFacet] = useState<{ value: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [planTarget, setPlanTarget] = useState<types.Exercise | null>(null)
  const [creating, setCreating] = useState(false)

  const part = params.get('part') || 'all'
  const equipment = params.get('equipment') || ''

  const loadExercises = useCallback(() => {
    setLoading(true)
    exerciseAPI.list({ limit: 2000 })
      .then(setExercises)
      .catch(() => setExercises([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadExercises() }, [loadExercises])
  useEffect(() => {
    exerciseAPI.facets().then(f => setEquipmentFacet(f.equipment ?? [])).catch(() => {})
  }, [])

  // Keep `q` in the URL so a shared link reproduces the whole view, but write
  // it on a delay — one history entry per keystroke would bury the back button.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params)
      if (query) next.set('q', query)
      else next.delete('q')
      if (next.toString() !== params.toString()) setParams(next, { replace: true })
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const setPart = (key: string) => {
    const next = new URLSearchParams(params)
    if (key === 'all') next.delete('part')
    else next.set('part', key)
    setParams(next, { replace: true })
  }

  const setEquipment = (value: string) => {
    const next = new URLSearchParams(params)
    if (params.get('equipment') === value) next.delete('equipment')
    else next.set('equipment', value)
    setParams(next, { replace: true })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return exercises.filter(ex => {
      if (q && !ex.name.toLowerCase().includes(q)) return false
      if (part !== 'all' && bodyPartOf(ex) !== part) return false
      if (equipment && ex.equipment !== equipment) return false
      return true
    })
  }, [exercises, query, part, equipment])

  const activeCount = exercises.length

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Exercises"
        subtitle={loading ? 'Loading…' : `${activeCount} exercise${activeCount === 1 ? '' : 's'} with animations`}
      />

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tx-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="input pl-10 w-full"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-muted"
          >
            <X className="w-3.5 h-3.5 text-tx-muted" />
          </button>
        )}
      </div>

      <HScrollTabs className="mb-2">
        {PART_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPart(key)}
            aria-pressed={part === key}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              part === key
                ? 'bg-brand-500 text-white'
                : 'bg-surface-muted text-tx-secondary hover:bg-surface-overlay'
            }`}
          >
            {label}
          </button>
        ))}
      </HScrollTabs>

      <HScrollTabs className="mb-4">
        <button
          onClick={() => setEquipment('')}
          aria-pressed={!equipment}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            !equipment ? 'bg-brand-500 text-white' : 'bg-surface-muted text-tx-secondary hover:bg-surface-overlay'
          }`}
        >
          Any equipment
        </button>
        {equipmentFacet.map(({ value }) => (
          <button
            key={value}
            onClick={() => setEquipment(value)}
            aria-pressed={equipment === value}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              equipment === value ? 'bg-brand-500 text-white' : 'bg-surface-muted text-tx-secondary hover:bg-surface-overlay'
            }`}
          >
            {EQUIPMENT_LABEL[value] || value}
          </button>
        ))}
      </HScrollTabs>

      <ExerciseGrid
        exercises={filtered}
        loading={loading}
        onOpen={ex => navigate(`/exercises/${ex.id}`)}
        renderAction={ex => (
          <button
            onClick={e => { e.stopPropagation(); setPlanTarget(ex) }}
            className="btn-secondary btn-sm flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Plan
          </button>
        )}
        emptyLabel={part !== 'all' || equipment || query ? 'No exercises match those filters' : 'No exercises found'}
        leadingCard={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-dashed border-surface-border bg-surface-elevated hover:bg-surface-muted transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-brand-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-tx-primary">Create your own exercise</p>
              <p className="text-xs text-tx-muted">name + body part, no animation</p>
            </div>
            <Plus className="w-4 h-4 text-tx-muted flex-shrink-0" />
          </button>
        }
      />

      {planTarget && <AddToRoutineSheet exercise={planTarget} onClose={() => setPlanTarget(null)} />}
      {creating && (
        <CreateExerciseSheet
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); loadExercises() }}
        />
      )}
    </div>
  )
}
