import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, HeartPulse, Save, AlertCircle, AlertTriangle, Activity } from 'lucide-react'
import { bloodPressureAPI } from '../services/api'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { classifyBP, BP_CATEGORIES, BP_CONTEXTS, BP_CRISIS_WARNING, formatBP } from '../utils/bloodPressure'
import SegmentedControl from './ui/SegmentedControl'
import * as types from '../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: (log: types.BloodPressureLog) => void
}

/** Matches the backend validate tags, so a typo is caught before the round-trip. */
const LIMITS = { sysMin: 50, sysMax: 300, diaMin: 30, diaMax: 200 }

/**
 * Guess the context from the clock. SegmentedControl has no "nothing selected"
 * state, so rather than show a misleading default we pick the one that is
 * almost always right — and a pre-filled correct tag beats an untagged reading,
 * since the capture-protocol rules ("no morning readings this week") depend on
 * these being present.
 */
function defaultContext(): types.BPContext {
  return new Date().getHours() < 12 ? 'morning' : 'evening'
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not an ISO instant. */
function nowLocalInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function BPEntrySheet({ isOpen, onClose, onSuccess }: Props) {
  const [systolic, setSystolic] = useState('')
  const [diastolic, setDiastolic] = useState('')
  const [pulse, setPulse] = useState('')
  const [context, setContext] = useState<types.BPContext>(defaultContext())
  const [rested, setRested] = useState(false)
  const [arm, setArm] = useState<'left' | 'right'>('left')
  const [when, setWhen] = useState(nowLocalInput())
  const [notes, setNotes] = useState('')
  const [showExtras, setShowExtras] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setSystolic('')
    setDiastolic('')
    setPulse('')
    setContext(defaultContext())
    setRested(false)
    setArm('left')
    setWhen(nowLocalInput())
    setNotes('')
    setShowExtras(false)
    setError('')
    setSaving(false)
  }, [isOpen])

  const handleClose = () => { setError(''); onClose() }

  useBodyScrollLock(isOpen)
  useEscapeKey(isOpen, handleClose)

  if (!isOpen) return null

  const sys = parseInt(systolic, 10)
  const dia = parseInt(diastolic, 10)
  const bothValid =
    Number.isFinite(sys) && Number.isFinite(dia) &&
    sys >= LIMITS.sysMin && sys <= LIMITS.sysMax &&
    dia >= LIMITS.diaMin && dia <= LIMITS.diaMax &&
    sys > dia

  // Live feedback as they type. Purely local — the server stamps the
  // authoritative category on the saved reading.
  const category = bothValid ? classifyBP(sys, dia) : null
  const meta = category ? BP_CATEGORIES[category] : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!Number.isFinite(sys) || !Number.isFinite(dia)) {
      setError('Enter both numbers.')
      return
    }
    if (sys <= dia) {
      setError('Systolic (the top number) must be higher than diastolic.')
      return
    }
    if (sys < LIMITS.sysMin || sys > LIMITS.sysMax || dia < LIMITS.diaMin || dia > LIMITS.diaMax) {
      setError('That reading is outside the range a cuff can produce — check the numbers.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const log = await bloodPressureAPI.log({
        systolic: sys,
        diastolic: dia,
        pulse: pulse ? parseInt(pulse, 10) : undefined,
        context,
        arm,
        rested,
        notes: notes.trim(),
        // Minutes east of UTC. getTimezoneOffset() returns minutes *behind*, so negate.
        tz_offset: -new Date().getTimezoneOffset(),
        logged_at: new Date(when).toISOString(),
      })
      onSuccess(log)
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save')
      setSaving(false)
    }
  }

  return createPortal((
    <div
      className="fixed inset-0 bg-black/60 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bp-sheet-title"
        className="bg-surface-base border border-surface-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto w-10 h-1 rounded-full bg-surface-muted mt-3 mb-1 sm:hidden" />

        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
              <HeartPulse className="w-4 h-4 text-brand-500" />
            </div>
            <h2 id="bp-sheet-title" className="font-display font-bold text-lg text-tx-primary">Log Blood Pressure</h2>
          </div>
          <button onClick={handleClose} aria-label="Close" className="p-1.5 hover:bg-surface-muted rounded-lg transition-colors">
            <X className="w-5 h-5 text-tx-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="alert-error" role="alert" aria-live="polite">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="bp-systolic" className="label">Systolic</label>
              <input
                id="bp-systolic"
                type="text"
                inputMode="numeric"
                value={systolic}
                onChange={e => setSystolic(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                placeholder="120"
                autoFocus
                className="input mt-1 text-2xl font-display font-bold text-center"
              />
            </div>
            <div className="pb-3 text-2xl font-display font-bold text-tx-muted">/</div>
            <div className="flex-1">
              <label htmlFor="bp-diastolic" className="label">Diastolic</label>
              <input
                id="bp-diastolic"
                type="text"
                inputMode="numeric"
                value={diastolic}
                onChange={e => setDiastolic(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                placeholder="80"
                className="input mt-1 text-2xl font-display font-bold text-center"
              />
            </div>
          </div>

          {/* Live category. Instant, deterministic, and identical on a server
              with no AI provider configured. */}
          {meta && category && (
            <div aria-live="polite">
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium ${meta.chip}`}>
                <span>{formatBP(sys, dia)}</span>
                <span className="opacity-60">·</span>
                <span data-testid="bp-live-category">{meta.label}</span>
              </div>
              <p className="text-xs text-tx-muted mt-2">{meta.blurb}</p>
            </div>
          )}

          {category === 'crisis' && (
            <div
              className="flex items-start gap-3 rounded-xl border border-red-600/40 bg-red-600/15 px-4 py-3 text-sm text-red-300"
              role="alert"
              data-testid="bp-crisis-warning"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>{BP_CRISIS_WARNING}</p>
            </div>
          )}

          <div>
            <span className="label">When was this taken?</span>
            <div className="mt-1">
              <SegmentedControl
                options={BP_CONTEXTS}
                value={context}
                onChange={setContext}
                size="sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={rested}
              onChange={e => setRested(e.target.checked)}
              className="w-4 h-4 rounded accent-brand-500"
            />
            <span className="text-sm text-tx-secondary">
              I sat quietly for 5 minutes first
            </span>
          </label>

          {!showExtras ? (
            <button
              type="button"
              onClick={() => setShowExtras(true)}
              className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              + Add pulse, arm, time or a note
            </button>
          ) : (
            <div className="space-y-3 pt-1">
              <div>
                <label htmlFor="bp-pulse" className="label">
                  <Activity className="w-3 h-3" /> Pulse <span className="text-tx-muted font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="bp-pulse"
                  type="text"
                  inputMode="numeric"
                  value={pulse}
                  onChange={e => setPulse(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                  placeholder="bpm"
                  className="input mt-1"
                />
              </div>
              <div>
                <span className="label">Arm</span>
                <div className="mt-1">
                  <SegmentedControl
                    options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] as const}
                    value={arm}
                    onChange={setArm}
                    size="sm"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="bp-when" className="label">Date &amp; time</label>
                <input
                  id="bp-when"
                  type="datetime-local"
                  value={when}
                  onChange={e => setWhen(e.target.value)}
                  max={nowLocalInput()}
                  className="input mt-1"
                />
              </div>
              <div>
                <label htmlFor="bp-notes" className="label">Note <span className="text-tx-muted font-normal normal-case tracking-normal">(optional)</span></label>
                <input
                  id="bp-notes"
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g., slept badly, extra coffee"
                  maxLength={200}
                  className="input mt-1"
                />
              </div>
            </div>
          )}

          {/* Enabled even in the crisis case — never stop someone recording
              their own reading; the warning above is the right response. */}
          <button type="submit" disabled={!bothValid || saving} className="btn-primary btn-lg w-full">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Reading'}
          </button>
        </form>
      </div>
    </div>
  ), document.body)
}
