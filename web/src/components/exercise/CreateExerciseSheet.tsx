import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, Camera, ImagePlus, X, AlertCircle, Dumbbell, Trash2, Timer } from 'lucide-react'
import { Sheet } from '../ui'
import { exerciseAPI, apiErrorMessage } from '../../services/api'
import { MUSCLE_COLORS, muscleColorBordered } from '../../utils/exerciseUtils'
import * as types from '../../types'

interface Props {
  onClose: () => void
  /** Presence implies edit mode; omit for create mode. */
  exercise?: types.Exercise
  /** Create mode only. */
  onCreated?: (exercise: types.Exercise) => void
  /** Edit mode only. */
  onSaved?: (exercise: types.Exercise) => void
  onDeleted?: (id: number) => void
}

// maxExerciseImageBytes mirrors the backend's cap on the base64 image_url
// payload (controllers/exercises.go) so an oversized photo fails fast
// client-side instead of round-tripping to the server.
const maxExerciseImageBytes = 5_600_000

const MUSCLE_OPTIONS = Object.keys(MUSCLE_COLORS)

/**
 * Create or edit a custom exercise: name, photo, instructions, and primary +
 * secondary muscles worked. Every exercise created here is tagged
 * source=custom server-side, which is what drives the "Custom" badge shown
 * elsewhere in the app.
 */
export default function CreateExerciseSheet({ onClose, exercise, onCreated, onSaved, onDeleted }: Props) {
  const isEdit = !!exercise

  const [name, setName] = useState(exercise?.name ?? '')
  const [primaryMuscle, setPrimaryMuscle] = useState(exercise?.muscle_group ?? MUSCLE_OPTIONS[0])
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>(exercise?.secondary_muscles ?? [])
  const [description, setDescription] = useState(exercise?.description ?? '')
  const [imageUrl, setImageUrl] = useState(exercise?.image_url ?? '')
  const [isTimed, setIsTimed] = useState(exercise?.is_timed ?? false)
  const [defaultDuration, setDefaultDuration] = useState(exercise?.default_duration_seconds || 30)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(exercise?.name ?? '')
    setPrimaryMuscle(exercise?.muscle_group ?? MUSCLE_OPTIONS[0])
    setSecondaryMuscles(exercise?.secondary_muscles ?? [])
    setDescription(exercise?.description ?? '')
    setImageUrl(exercise?.image_url ?? '')
    setIsTimed(exercise?.is_timed ?? false)
    setDefaultDuration(exercise?.default_duration_seconds || 30)
    setError(null)
    setConfirmDelete(false)
  }, [exercise?.id])

  const applyImage = (url: string) => {
    if (url.length > maxExerciseImageBytes) {
      setError('Photo is too large, try a smaller image.')
      return
    }
    setImageUrl(url)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => applyImage(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const toggleSecondary = (m: string) => {
    setSecondaryMuscles(cur => cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m])
  }

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    const payload: types.ExerciseInput = {
      name: trimmed,
      muscle_group: primaryMuscle,
      secondary_muscles: secondaryMuscles.filter(m => m !== primaryMuscle),
      description: description.trim(),
      image_url: imageUrl,
      equipment: exercise?.equipment,
      category: exercise?.category,
      is_timed: isTimed,
      default_duration_seconds: isTimed ? defaultDuration : 0,
    }
    try {
      if (isEdit) {
        const updated = await exerciseAPI.update(exercise!.id, payload)
        onSaved?.(updated)
      } else {
        const created = await exerciseAPI.create(payload)
        onCreated?.(created)
      }
    } catch (err) {
      setError(apiErrorMessage(err, `Failed to ${isEdit ? 'save' : 'create'} exercise.`))
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!exercise || deleting) return
    setDeleting(true)
    try {
      await exerciseAPI.delete(exercise.id)
      onDeleted?.(exercise.id)
      onClose()
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete exercise.'))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (cameraOpen) {
    return createPortal(
      <div className="fixed inset-0 z-[80] bg-black/95 flex flex-col">
        <div className="flex items-center justify-between p-4">
          <p className="text-white text-sm font-medium">Take exercise photo</p>
          <button onClick={() => setCameraOpen(false)} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <ExercisePhotoCapture
            onCapture={url => { applyImage(url); setCameraOpen(false) }}
            onClose={() => setCameraOpen(false)}
          />
        </div>
      </div>,
      document.body,
    )
  }

  return (
    <Sheet
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit exercise' : 'Create your own exercise'}
      icon={<Sparkles className="w-4 h-4 text-brand-500" />}
    >
      <div className="p-5">
        {error && (
          <div className="alert-error mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Photo card */}
        <div className="card overflow-hidden mb-4">
          <div className="relative">
            {imageUrl ? (
              <img src={imageUrl} alt={name} className="w-full h-40 object-cover" onError={() => setImageUrl('')} />
            ) : (
              <div className="w-full h-40 bg-surface-muted flex flex-col items-center justify-center gap-2">
                <Dumbbell className="w-8 h-8 text-tx-muted opacity-20" />
                <p className="text-xs text-tx-muted">No photo yet</p>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex items-end p-3 gap-2">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white text-xs font-medium hover:bg-white/20 transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
                Take photo
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white text-xs font-medium hover:bg-white/20 transition-colors"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Upload
              </button>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>

        <label className="block mb-4">
          <span className="text-xs font-medium text-tx-muted mb-1 block">Name</span>
          <input
            autoFocus={!isEdit}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Sled Push"
            className="input w-full"
          />
        </label>

        <div className="mb-4">
          <span className="text-xs font-medium text-tx-muted mb-1 block">Primary muscle</span>
          <div className="flex gap-2 flex-wrap">
            {MUSCLE_OPTIONS.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setPrimaryMuscle(m)}
                className={`capitalize px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  primaryMuscle === m ? muscleColorBordered(m) : 'bg-surface-muted text-tx-muted border-surface-border'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <span className="text-xs font-medium text-tx-muted mb-1 block">Secondary muscles (optional)</span>
          <div className="flex gap-2 flex-wrap">
            {MUSCLE_OPTIONS.filter(m => m !== primaryMuscle).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => toggleSecondary(m)}
                className={`capitalize px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  secondaryMuscles.includes(m) ? muscleColorBordered(m) : 'bg-surface-muted text-tx-muted border-surface-border'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <label className="block mb-6">
          <span className="text-xs font-medium text-tx-muted mb-1 block">Instructions (optional)</span>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={'1. Set up...\n2. Perform the movement...'}
            rows={4}
            className="input w-full resize-none"
          />
        </label>

        <div className="mb-6">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isTimed}
              onChange={e => setIsTimed(e.target.checked)}
              className="w-4 h-4 rounded accent-brand-500"
            />
            <Timer className="w-4 h-4 text-tx-muted" />
            <span className="text-sm text-tx-secondary">Timed exercise (e.g. a plank or stretch)</span>
          </label>
          {isTimed && (
            <label className="flex items-center gap-2 mt-3 pl-6">
              <span className="text-xs font-medium text-tx-muted">Default hold duration</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={defaultDuration}
                onChange={e => setDefaultDuration(Math.max(1, Math.round(Number(e.target.value) || 0)))}
                className="input text-sm text-center py-1.5 w-20"
                aria-label="Default hold duration in seconds"
              />
              <span className="text-xs text-tx-muted">sec</span>
            </label>
          )}
        </div>

        {isEdit && (
          <div className="mb-4">
            {confirmDelete ? (
              <div className="space-y-3">
                <p className="text-sm text-tx-secondary text-center">Delete <span className="font-semibold text-tx-primary">{name}</span>?</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="btn-secondary flex-1">Cancel</button>
                  <button onClick={handleDelete} disabled={deleting} className="btn-danger-solid flex-1 disabled:opacity-50">
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-error-400 hover:text-error-300 transition-colors text-sm font-medium w-full justify-center py-1"
              >
                <Trash2 className="w-4 h-4" />
                Delete custom exercise
              </button>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 bg-surface-muted hover:bg-surface-muted/80 text-tx-secondary rounded-xl transition-colors font-medium text-sm">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
            className="flex-1 py-3 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-xl transition-colors font-semibold text-sm"
          >
            {saving ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ─── ExercisePhotoCapture — plain camera capture, no analysis ─────────────

function ExercisePhotoCapture({ onCapture, onClose }: { onCapture: (url: string) => void; onClose: () => void }) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch((e: any) => setErr(e?.message ?? String(e)))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const capture = () => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const { videoWidth: w, videoHeight: h } = video
    if (!w || !h) return
    const scale = Math.max(w, h) > 1600 ? 1600 / Math.max(w, h) : 1
    canvas.width  = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    onCapture(canvas.toDataURL('image/jpeg', 0.85))
  }

  if (err) {
    return (
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <AlertCircle className="w-8 h-8 text-error-400" />
        <p className="text-white text-sm">Camera unavailable</p>
        <p className="text-white/50 text-xs">{err}</p>
        <button onClick={onClose} className="btn-primary btn-sm mt-2">Cancel</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center w-full gap-4 px-4">
      <video ref={videoRef} autoPlay playsInline muted className="w-full max-w-sm rounded-xl" style={{ maxHeight: '55vh', objectFit: 'cover' }} />
      <canvas ref={canvasRef} className="hidden" />
      <p className="text-white/60 text-xs text-center">Frame the exercise, then tap to capture</p>
      <button
        onClick={capture}
        className="w-16 h-16 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Capture exercise photo"
      >
        <Camera className="w-6 h-6 text-black" />
      </button>
    </div>
  )
}
