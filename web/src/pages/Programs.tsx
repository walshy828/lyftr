import { useState, useEffect } from 'react'
import { BookOpen, Plus, Dumbbell, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Loading from '../components/Loading'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import ProgramCard from '../components/ProgramCard'
import { useServerInfiniteList } from '../hooks/useServerInfiniteList'
import { programAPI } from '../services/api'
import * as types from '../types'

export default function Programs() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'mine' | 'shared'>('mine')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const mine = useServerInfiniteList<types.Program>({
    fetcher: (offset, limit) => programAPI.list({ offset, limit, q: debouncedSearch || undefined }),
    deps: [debouncedSearch],
  })
  const shared = useServerInfiniteList<types.Program>({
    fetcher: (offset, limit) => programAPI.listShared({ offset, limit, q: debouncedSearch || undefined }),
    deps: [debouncedSearch],
  })
  const active = tab === 'mine' ? mine : shared

  if (mine.initialLoading || shared.initialLoading) return <Loading />

  return (
    <div className="space-y-5 animate-slide-up">
      <PageHeader
        title="Programs"
        subtitle="Reusable workout templates"
        action={
          <button onClick={() => navigate('/programs/new')} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> New Program
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Total', value: active.items.length.toString(), unit: 'programs', icon: BookOpen },
          { label: 'Avg Exercises', value: active.items.length > 0 ? Math.round(active.items.reduce((s, p) => s + (p.exercises?.length || 0), 0) / active.items.length).toString() : '0', unit: 'per program', icon: Dumbbell },
        ].map(s => (
          <div key={s.label} className="card p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="stat-label">{s.label}</span>
            </div>
            <div className="flex items-end gap-1.5">
              <span className="stat-value text-xl">{s.value}</span>
              <span className="text-xs text-tx-muted mb-0.5">{s.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <SegmentedControl
        options={[
          { value: 'mine', label: 'My Programs' },
          { value: 'shared', label: 'Shared' },
        ] as const}
        value={tab}
        onChange={setTab}
      />

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-tx-muted pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input pl-10"
          placeholder={tab === 'mine' ? 'Search programs…' : 'Search shared programs…'}
        />
      </div>

      <div className="space-y-2">
        {active.items.length === 0 && !active.loading ? (
          <div className="empty-state">
            <div className="w-12 h-12 rounded-xl bg-surface-muted border border-surface-border flex items-center justify-center mb-4">
              <BookOpen className="w-6 h-6 text-tx-muted" />
            </div>
            <p className="text-sm font-medium text-tx-primary mb-1">
              {tab === 'mine' ? 'No programs found' : 'No shared programs found'}
            </p>
            <p className="text-xs text-tx-muted">
              {search
                ? 'Try a different search'
                : tab === 'mine'
                  ? 'Create a program to get started'
                  : 'No one has shared a program yet'}
            </p>
          </div>
        ) : (
          <>
            {active.items.map(p => (
              <ProgramCard
                key={p.id}
                program={p}
                variant={tab === 'mine' ? 'own' : 'shared'}
                onEdit={(id) => navigate(`/programs/${id}/edit`)}
                onDelete={() => mine.reload()}
                onShareToggle={() => mine.reload()}
                onCopy={(copy) => navigate(`/programs/${copy.id}/edit`)}
              />
            ))}
            <div ref={active.sentinelRef} />
            {active.hasMore && active.loading && (
              <p className="text-center text-xs text-tx-muted py-2">Loading more…</p>
            )}
          </>
        )}
      </div>

    </div>
  )
}
