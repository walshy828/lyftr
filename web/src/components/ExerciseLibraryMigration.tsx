import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Loader, ArrowRight, CheckCircle2 } from 'lucide-react'
import { exerciseMigrationAPI, apiErrorMessage } from '../services/api'
import * as types from '../types'

const SOURCE_LABEL: Record<string, string> = {
  free: 'free-exercise-db (photo crossfade)',
  gymvisual: 'Gymvisual (animated GIFs)',
}

const OTHER_SOURCE: Record<string, string> = { free: 'gymvisual', gymvisual: 'free' }

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-success-500/15 text-success-400 border-success-500/30',
  medium: 'bg-warning-500/15 text-warning-400 border-warning-500/30',
  low: 'bg-error-500/15 text-error-400 border-error-500/30',
}

/**
 * Admin-only "switch exercise library" flow: preview an AI-proposed mapping
 * from the currently-in-use exercises onto the other library, let the admin
 * hand-resolve anything below "high" confidence, then confirm to repoint
 * workout/program history and remove the old library. See
 * backend/controllers/exercise_migration.go for the sequencing this drives.
 *
 * Deliberately not exposed to non-admins: the backend endpoints are already
 * gated by AdminOnly, so a non-admin sees a 403 on preview and the section
 * just shows that error — no separate visibility check needed here.
 */
export default function ExerciseLibraryMigration() {
  const [status, setStatus] = useState<types.ExerciseMigrationStatus | null>(null)
  const [proposal, setProposal] = useState<types.ExerciseMigration | null>(null)
  const [edits, setEdits] = useState<Record<number, { matched_name: string; leave_unmigrated: boolean }>>({})
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<types.ExerciseMigrationResult | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const s = await exerciseMigrationAPI.status()
      setStatus(s)
      if (s.latest_migration?.status === 'proposed') {
        setProposal(s.latest_migration)
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load exercise library status"))
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  const startPreview = async () => {
    if (!status) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const toSource = OTHER_SOURCE[status.current_source] ?? 'gymvisual'
      const p = await exerciseMigrationAPI.preview(toSource)
      setProposal(p)
      const seed: Record<number, { matched_name: string; leave_unmigrated: boolean }> = {}
      for (const m of p.mapping) {
        seed[m.old_exercise_id] = { matched_name: m.matched_name ?? '', leave_unmigrated: false }
      }
      setEdits(seed)
    } catch (err) {
      setError(apiErrorMessage(err, "Could not compute a migration preview"))
    } finally {
      setLoading(false)
    }
  }

  const cancelPreview = () => {
    setProposal(null)
    setEdits({})
  }

  const allResolved = proposal
    ? proposal.mapping.every(m => {
        const e = edits[m.old_exercise_id]
        return e?.leave_unmigrated || !!e?.matched_name.trim()
      })
    : false

  const confirm = async () => {
    if (!proposal) return
    setConfirming(true)
    setError(null)
    try {
      const mapping: types.ExerciseMigrationMappingEntry[] = proposal.mapping.map(m => {
        const e = edits[m.old_exercise_id]
        return {
          old_exercise_id: m.old_exercise_id,
          old_name: m.old_name,
          matched_name: e?.leave_unmigrated ? '' : (e?.matched_name.trim() || m.matched_name),
          confidence: m.confidence,
          reasoning: m.reasoning,
          leave_unmigrated: !!e?.leave_unmigrated,
        }
      })
      const res = await exerciseMigrationAPI.confirm(proposal.id, mapping)
      setResult(res)
      setProposal(null)
      setEdits({})
      loadStatus()
    } catch (err) {
      setError(apiErrorMessage(err, "Migration failed"))
    } finally {
      setConfirming(false)
    }
  }

  // A failed initial load (most commonly: this account isn't in ADMIN_EMAILS,
  // so /admin/exercise-migration/status 403s) must still say something —
  // silently rendering nothing here previously made a real permissions/config
  // problem indistinguishable from "the feature doesn't exist".
  if (!status) {
    return error ? (
      <div className="py-3 flex items-center gap-2 text-xs text-error-400">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        {error}
      </div>
    ) : null
  }

  return (
    <div className="py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-tx-muted">
          Active library: <span className="text-tx-secondary font-medium">{SOURCE_LABEL[status.current_source] ?? status.current_source}</span>
        </p>
        {!proposal && (
          <button onClick={startPreview} disabled={loading} className="btn-secondary btn-sm">
            {loading
              ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Matching…</>
              : <>Switch to {SOURCE_LABEL[OTHER_SOURCE[status.current_source]] ?? OTHER_SOURCE[status.current_source]}</>
            }
          </button>
        )}
      </div>

      {result && (
        <div className="flex items-start gap-2 text-xs text-success-400 bg-success-500/10 border border-success-500/20 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{result.message}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-error-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {proposal && (
        <div className="border border-surface-border rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2 text-xs text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              This repoints {proposal.mapping.length} exercise{proposal.mapping.length === 1 ? '' : 's'} used in your workouts/programs
              and permanently removes the old library. Back up your database file first — this can&apos;t be undone.
            </span>
          </div>

          {proposal.mapping.length === 0 ? (
            <p className="text-xs text-tx-muted">No exercises are currently in use — nothing to remap. Confirming just switches the library.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {proposal.mapping.map(m => {
                const e = edits[m.old_exercise_id] ?? { matched_name: m.matched_name ?? '', leave_unmigrated: false }
                const needsReview = m.confidence !== 'high'
                return (
                  <div key={m.old_exercise_id} className="flex items-center gap-2 text-xs py-1.5 border-b border-surface-border last:border-0">
                    <span className="flex-1 truncate text-tx-secondary">{m.old_name}</span>
                    <ArrowRight className="w-3 h-3 text-tx-muted flex-shrink-0" />
                    {needsReview ? (
                      <input
                        type="text"
                        value={e.matched_name}
                        disabled={e.leave_unmigrated}
                        onChange={ev => setEdits(prev => ({ ...prev, [m.old_exercise_id]: { ...e, matched_name: ev.target.value } }))}
                        placeholder="exact name in target library"
                        className="input text-xs py-1 flex-1 min-w-0 disabled:opacity-50"
                      />
                    ) : (
                      <span className="flex-1 truncate text-tx-primary font-medium">{m.matched_name}</span>
                    )}
                    <span className={`badge text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${CONFIDENCE_STYLE[m.confidence] ?? ''}`}>
                      {m.confidence}
                    </span>
                    {needsReview && (
                      <label className="flex items-center gap-1 text-[10px] text-tx-muted flex-shrink-0 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={e.leave_unmigrated}
                          onChange={ev => setEdits(prev => ({ ...prev, [m.old_exercise_id]: { ...e, leave_unmigrated: ev.target.checked } }))}
                        />
                        keep old
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={cancelPreview} disabled={confirming} className="btn-secondary btn-sm flex-1">Cancel</button>
            <button
              onClick={confirm}
              disabled={confirming || !allResolved}
              className="btn-primary btn-sm flex-1"
            >
              {confirming
                ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Migrating…</>
                : 'Confirm migration'
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
