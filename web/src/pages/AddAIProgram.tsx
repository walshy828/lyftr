import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, Sparkles, CheckCircle2, Trash2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { programAPI, exerciseAPI } from '../services/api'
import ProgramEditor, { ProgramFormData } from '../components/ProgramEditor'
import * as types from '../types'

interface DraftCard {
  formData: ProgramFormData
  status: 'pending' | 'discarded' | 'saved'
  expanded: boolean
  createdId?: number
  createdName?: string
}

function toFormData(draft: types.DraftProgram): ProgramFormData {
  return {
    name: draft.name,
    notes: draft.notes ?? '',
    exercises: (draft.exercises ?? []).map(ex => ({
      exercise_id: ex.exercise_id,
      notes: ex.notes ?? '',
      rest_seconds: ex.rest_seconds ?? 90,
      sets: (ex.sets ?? []).map(s => ({ set_number: s.set_number, target_reps: s.target_reps, target_weight: s.target_weight })),
    })),
  }
}

export default function AddAIProgram() {
  const navigate = useNavigate()
  const [goals, setGoals] = useState('')
  const [focusAreas, setFocusAreas] = useState('')
  const [equipment, setEquipment] = useState('')
  const [timePeriod, setTimePeriod] = useState('')
  const [numberOfDays, setNumberOfDays] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftCard[] | null>(null)
  const [pickerExercises, setPickerExercises] = useState<Record<number, types.Exercise>>({})

  const generate = async () => {
    if (!goals.trim() || generating) return
    setGenerating(true)
    setError(null)
    try {
      const [{ programs }, catalog] = await Promise.all([
        programAPI.generate({
          goals: goals.trim(),
          focus_areas: focusAreas.trim() || undefined,
          equipment: equipment.trim() || undefined,
          time_period: timePeriod.trim() || undefined,
          number_of_days: numberOfDays,
        }),
        exerciseAPI.list(),
      ])
      if (!programs || programs.length === 0) {
        setError("Couldn't generate a program from that description — try adding more detail")
        return
      }
      const map: Record<number, types.Exercise> = {}
      catalog.forEach(e => { map[e.id] = e })
      setPickerExercises(map)
      setDrafts(programs.map(p => ({ formData: toFormData(p), status: 'pending', expanded: programs.length === 1 })))
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setError(err?.response?.data?.error || 'AI program builder is not configured on this server')
      } else {
        setError('Could not generate a program — try again or build one manually')
      }
    } finally {
      setGenerating(false)
    }
  }

  const discard = (idx: number) => {
    setDrafts(prev => prev ? prev.map((d, i) => i === idx ? { ...d, status: 'discarded' } : d) : prev)
  }

  const toggleExpanded = (idx: number) => {
    setDrafts(prev => prev ? prev.map((d, i) => i === idx ? { ...d, expanded: !d.expanded } : d) : prev)
  }

  const saveDraft = async (idx: number, payload: ProgramFormData) => {
    const created = await programAPI.create(payload)
    setDrafts(prev => prev ? prev.map((d, i) => i === idx ? { ...d, status: 'saved', expanded: false, createdId: created.id, createdName: created.name } : d) : prev)
  }

  if (!drafts) {
    return (
      <div className="space-y-6 animate-slide-up pb-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-muted rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-tx-muted" />
          </button>
          <div>
            <h1 className="font-display font-bold text-2xl text-tx-primary">AI Program Builder</h1>
            <p className="text-xs text-tx-muted">Describe your goals and let AI draft a program to review</p>
          </div>
        </div>

        {error && (
          <div className="alert-error">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="label">Goals <span className="text-xs text-tx-muted">(required)</span></label>
            <textarea
              value={goals}
              onChange={e => setGoals(e.target.value)}
              placeholder='e.g. "Build strength and agility for hockey — explosive lower body power and quick change of direction"'
              className="input mt-1 min-h-20 resize-none"
            />
          </div>

          <div>
            <label className="label">Focus areas</label>
            <input value={focusAreas} onChange={e => setFocusAreas(e.target.value)} placeholder="e.g. legs, core, agility" className="input mt-1" />
          </div>

          <div>
            <label className="label">Equipment available</label>
            <input value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="e.g. barbell, dumbbells, resistance bands" className="input mt-1" />
          </div>

          <div>
            <label className="label">Time period</label>
            <input value={timePeriod} onChange={e => setTimePeriod(e.target.value)} placeholder="e.g. 6 weeks" className="input mt-1" />
          </div>

          <div>
            <label className="label">Number of days</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={14}
              value={numberOfDays}
              onChange={e => setNumberOfDays(Math.min(14, Math.max(1, Number(e.target.value) || 1)))}
              className="input mt-1 w-24"
            />
            <p className="text-xs text-tx-muted mt-1">Each day becomes its own program you can review and save separately.</p>
          </div>
        </div>

        <button onClick={generate} disabled={!goals.trim() || generating} className="btn-primary btn-lg w-full flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4" />
          {generating ? 'Generating your program…' : 'Generate Program'}
        </button>
      </div>
    )
  }

  const pending = drafts.filter(d => d.status === 'pending').length
  const savedCount = drafts.filter(d => d.status === 'saved').length
  const allResolved = pending === 0

  return (
    <div className="space-y-6 animate-slide-up pb-10">
      <div className="flex items-center gap-3">
        <button onClick={() => setDrafts(null)} className="p-2 hover:bg-surface-muted rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-tx-muted" />
        </button>
        <div>
          <h1 className="font-display font-bold text-2xl text-tx-primary">Review Generated Programs</h1>
          <p className="text-xs text-tx-muted">{savedCount} saved • {pending} pending review</p>
        </div>
      </div>

      <div className="space-y-4">
        {drafts.map((draft, idx) => {
          if (draft.status === 'discarded') return null

          if (draft.status === 'saved') {
            return (
              <div key={idx} className="p-4 bg-surface-muted/30 border border-surface-border rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success-500" />
                  <span className="font-medium text-tx-primary">{draft.createdName}</span>
                </div>
                <Link to={`/programs/${draft.createdId}/edit`} className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium">
                  Edit <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            )
          }

          if (!draft.expanded) {
            const totalSets = draft.formData.exercises.reduce((sum, ex) => sum + ex.sets.length, 0)
            return (
              <div key={idx} className="p-4 bg-surface-muted/30 border border-surface-border rounded-lg flex items-center justify-between">
                <div>
                  <p className="font-medium text-tx-primary">{draft.formData.name}</p>
                  <p className="text-xs text-tx-muted">{draft.formData.exercises.length} exercises • {totalSets} sets</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleExpanded(idx)} className="p-1.5 hover:bg-surface-muted rounded transition-colors" aria-label="Expand to review">
                    <ChevronDown className="w-4 h-4 text-tx-muted" />
                  </button>
                  <button onClick={() => discard(idx)} className="p-1.5 hover:bg-error-500/20 rounded transition-colors" aria-label="Discard">
                    <Trash2 className="w-4 h-4 text-error-400" />
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div key={idx} className="p-4 bg-surface-muted/30 border border-surface-border rounded-lg">
              <div className="flex items-center justify-end gap-1 mb-2">
                <button onClick={() => toggleExpanded(idx)} className="p-1.5 hover:bg-surface-muted rounded transition-colors" aria-label="Collapse">
                  <ChevronUp className="w-4 h-4 text-tx-muted" />
                </button>
              </div>
              <ProgramEditor
                variant="embedded"
                title={draft.formData.name}
                initialData={draft.formData}
                initialPickerExercises={pickerExercises}
                saveLabel="Create Program"
                cancelLabel="Discard"
                onSave={payload => saveDraft(idx, payload)}
                onCancel={() => discard(idx)}
              />
            </div>
          )
        })}
      </div>

      {allResolved && (
        <button onClick={() => navigate('/programs')} className="btn-primary btn-lg w-full">
          Done
        </button>
      )}
    </div>
  )
}
