import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, X, SlidersHorizontal, Plus } from 'lucide-react'
import { exerciseAPI } from '../services/api'
import ExerciseList from '../components/exercise/ExerciseList'
import AddToRoutineSheet from '../components/AddToRoutineSheet'
import { PageHeader } from '../components/ui'
import { EQUIPMENT_LABEL } from '../utils/exerciseUtils'
import * as types from '../types'

// Ordered by how people actually narrow a search: what equipment is free, then
// what they want to train, then how hard it is.
const FACET_ORDER: { key: types.ExerciseFacetKey; label: string }[] = [
  { key: 'equipment', label: 'Equipment' },
  { key: 'muscle_group', label: 'Muscle' },
  { key: 'level', label: 'Level' },
  { key: 'mechanic', label: 'Type' },
  { key: 'force', label: 'Force' },
]

// Upstream values are lowercase and only some equipment has a friendly label
// ("body only" -> "Bodyweight"), so anything unmapped still gets title-cased
// rather than sitting next to the mapped chips in lowercase.
function titleCase(v: string): string {
  return v.replace(/\b\w/g, ch => ch.toUpperCase())
}

function chipLabel(key: types.ExerciseFacetKey, value: string): string {
  if (key === 'equipment' && EQUIPMENT_LABEL[value]) return EQUIPMENT_LABEL[value]
  return titleCase(value)
}

/**
 * Browse the whole exercise library.
 *
 * The backend has supported these filters for a long time but nothing ever
 * exposed them — discovery only happened through the in-session picker, which
 * searches by name. "What can I do with just dumbbells" was unanswerable.
 *
 * Selections live in the URL so a filtered view is linkable and survives a
 * back-navigation from an exercise's detail page.
 */
export default function Exercises() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [exercises, setExercises] = useState<types.Exercise[]>([])
  const [facets, setFacets] = useState<types.ExerciseFacets>({})
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [planTarget, setPlanTarget] = useState<types.Exercise | null>(null)

  // The active filter set, derived from the URL rather than mirrored in state —
  // one source of truth, so the back button can't desync the chips from the list.
  const active = useMemo(() => {
    const out: types.ExerciseQuery = {}
    for (const { key } of FACET_ORDER) {
      const v = params.get(key)
      if (v) out[key] = v
    }
    return out
  }, [params])

  const activeCount = Object.keys(active).length

  useEffect(() => { exerciseAPI.facets().then(setFacets).catch(() => {}) }, [])

  // Debounced so typing doesn't fire a request per keystroke. The filter params
  // are part of the key, so a chip tap re-runs it too.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      exerciseAPI
        .list({ ...active, q: query || undefined, limit: 2000 })
        .then(data => { if (!cancelled) setExercises(data || []) })
        .catch(() => { if (!cancelled) setExercises([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, active])

  const toggleFacet = (key: types.ExerciseFacetKey, value: string) => {
    const next = new URLSearchParams(params)
    if (next.get(key) === value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const clearAll = () => {
    const next = new URLSearchParams()
    if (query) next.set('q', query)
    setParams(next, { replace: true })
  }

  // Keep `q` in the URL so a shared link reproduces the whole view, but write it
  // on a delay — one history entry per keystroke would bury the back button.
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

  return (
    // A DEFINITE height, not a min-height. The list inside virtualizes against
    // its scroll container, and a container free to grow reports the full
    // content as visible — which renders all ~870 rows and defeats the point.
    // dvh so mobile browser chrome collapsing doesn't clip the list.
    <div className="animate-slide-up flex flex-col" style={{ height: 'calc(100dvh - 11rem)' }}>
      <PageHeader
        title="Exercises"
        subtitle={loading ? 'Loading…' : `${exercises.length} exercise${exercises.length === 1 ? '' : 's'}`}
      />

      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
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
        <button
          onClick={() => setShowFilters(v => !v)}
          aria-expanded={showFilters}
          className={`btn-secondary btn-sm flex-shrink-0 ${activeCount > 0 ? 'border-brand-500/40 text-brand-400' : ''}`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="ml-0.5 px-1.5 rounded-full bg-brand-500 text-white text-[10px] font-bold tabular-nums">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Active filters stay visible when the panel is closed, so a filtered
          list is never silently filtered. */}
      {activeCount > 0 && !showFilters && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {(Object.entries(active) as [types.ExerciseFacetKey, string][]).map(([key, value]) => (
            <button
              key={key}
              onClick={() => toggleFacet(key, value)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-brand-500/15 text-brand-300 border border-brand-500/25 hover:bg-brand-500/25 transition-colors"
            >
              {chipLabel(key, value)}
              <X className="w-3 h-3" />
            </button>
          ))}
          <button onClick={clearAll} className="text-xs text-tx-muted hover:text-tx-secondary px-1">
            Clear all
          </button>
        </div>
      )}

      {showFilters && (
        <div className="card p-3 mb-3 space-y-3">
          {FACET_ORDER.map(({ key, label }) => {
            const values = facets[key]
            if (!values?.length) return null
            return (
              <div key={key}>
                <p className="text-[10px] font-semibold text-tx-muted uppercase tracking-wider mb-1.5">{label}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {values.map(({ value, count }) => {
                    const selected = active[key] === value
                    return (
                      <button
                        key={value}
                        onClick={() => toggleFacet(key, value)}
                        aria-pressed={selected}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
                          selected
                            ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                            : 'bg-surface-muted/40 text-tx-secondary border-transparent hover:border-surface-border'
                        }`}
                      >
                        {chipLabel(key, value)}
                        <span className="text-tx-muted tabular-nums">{count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {activeCount > 0 && (
            <button onClick={clearAll} className="btn-ghost btn-sm">Clear all filters</button>
          )}
        </div>
      )}

      {/* min-h-0 is load-bearing: a flex child defaults to min-height:auto,
          which lets it grow to its content and re-breaks the bounded scroll
          container the virtualizer depends on. */}
      <div className="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <ExerciseList
          exercises={exercises}
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
          emptyLabel={activeCount > 0 || query ? 'No exercises match those filters' : 'No exercises found'}
        />
      </div>

      {planTarget && <AddToRoutineSheet exercise={planTarget} onClose={() => setPlanTarget(null)} />}
    </div>
  )
}
