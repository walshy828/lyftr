import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Camera, Trash2, AlertCircle, Utensils, ImagePlus, Check,
} from 'lucide-react'
import { savedFoodsAPI } from '../services/api'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useEscapeKey } from '../hooks/useEscapeKey'
import NutritionLabelCamera from './NutritionLabelCamera'
import * as types from '../types'

interface Props {
  food: types.SavedFood
  open: boolean
  onClose: () => void
  onSaved: (updated: types.SavedFood) => void
  onDeleted: (id: number) => void
}

type CameraMode = 'none' | 'food-photo' | 'label-scan'

const MACRO_FIELDS = [
  { key: 'calories'    as const, label: 'Calories',    unit: 'kcal', color: 'text-tx-primary' },
  { key: 'protein'     as const, label: 'Protein',     unit: 'g',    color: 'text-emerald-400' },
  { key: 'carbs'       as const, label: 'Carbs',       unit: 'g',    color: 'text-amber-400' },
  { key: 'fat'         as const, label: 'Fat',         unit: 'g',    color: 'text-violet-400' },
  { key: 'fiber'       as const, label: 'Fiber',       unit: 'g',    color: 'text-tx-secondary' },
  { key: 'sugar'       as const, label: 'Sugar',       unit: 'g',    color: 'text-tx-secondary' },
  { key: 'sodium'      as const, label: 'Sodium',      unit: 'mg',   color: 'text-tx-secondary' },
  { key: 'cholesterol' as const, label: 'Cholesterol', unit: 'mg',   color: 'text-tx-secondary' },
]

export default function EditSavedFoodSheet({ food, open, onClose, onSaved, onDeleted }: Props) {
  useBodyScrollLock(open)
  useEscapeKey(open, onClose)

  const [name, setName]               = useState(food.name)
  const [brand, setBrand]             = useState(food.brand ?? '')
  const [calories, setCalories]       = useState(food.calories)
  const [protein, setProtein]         = useState(food.protein)
  const [carbs, setCarbs]             = useState(food.carbs)
  const [fat, setFat]                 = useState(food.fat)
  const [fiber, setFiber]             = useState(food.fiber)
  const [sugar, setSugar]             = useState(food.sugar ?? 0)
  const [sodium, setSodium]           = useState(food.sodium ?? 0)
  const [cholesterol, setCholesterol] = useState(food.cholesterol ?? 0)
  const [servingSize, setServingSize] = useState(food.serving_size)
  const [imageUrl, setImageUrl]       = useState(food.image_url ?? '')
  const [cameraMode, setCameraMode]   = useState<CameraMode>('none')
  const [saving, setSaving]           = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [saved, setSaved]             = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset form when food prop changes (e.g. sheet opened for different food)
  useEffect(() => {
    setName(food.name)
    setBrand(food.brand ?? '')
    setCalories(food.calories)
    setProtein(food.protein)
    setCarbs(food.carbs)
    setFat(food.fat)
    setFiber(food.fiber)
    setSugar(food.sugar ?? 0)
    setSodium(food.sodium ?? 0)
    setCholesterol(food.cholesterol ?? 0)
    setServingSize(food.serving_size)
    setImageUrl(food.image_url ?? '')
    setError(null)
    setSaved(false)
    setConfirmDelete(false)
    setCameraMode('none')
  }, [food.id])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setImageUrl(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated = await savedFoodsAPI.update(food.id, {
        name: name.trim(),
        brand: brand.trim(),
        calories,
        protein,
        carbs,
        fat,
        fiber,
        sugar,
        sodium,
        cholesterol,
        serving_size: servingSize.trim(),
        barcode: food.barcode ?? '',
        image_url: imageUrl,
      })
      onSaved(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await savedFoodsAPI.delete(food.id)
      onDeleted(food.id)
      onClose()
    } catch {
      setError('Failed to delete')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!open) return null

  if (cameraMode === 'food-photo') {
    return createPortal(
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
        <div className="flex items-center justify-between p-4">
          <p className="text-white text-sm font-medium">Take food photo</p>
          <button onClick={() => setCameraMode('none')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <FoodPhotoCapture
            onCapture={url => { setImageUrl(url); setCameraMode('none') }}
            onClose={() => setCameraMode('none')}
          />
        </div>
      </div>,
      document.body,
    )
  }

  if (cameraMode === 'label-scan') {
    return createPortal(
      <NutritionLabelCamera
        onImageCapture={url => setImageUrl(url)}
        onResult={extraction => {
          if (extraction.calories)     setCalories(extraction.calories)
          if (extraction.protein)      setProtein(extraction.protein)
          if (extraction.carbs)        setCarbs(extraction.carbs)
          if (extraction.fat)          setFat(extraction.fat)
          if (extraction.fiber)        setFiber(extraction.fiber)
          if (extraction.sugar)        setSugar(extraction.sugar)
          if (extraction.sodium)       setSodium(extraction.sodium)
          if (extraction.cholesterol)  setCholesterol(extraction.cholesterol)
          if (extraction.name)         setName(extraction.name)
          if (extraction.brand)        setBrand(extraction.brand)
          if (extraction.serving_size) setServingSize(extraction.serving_size)
          setCameraMode('none')
        }}
        onClose={() => setCameraMode('none')}
      />,
      document.body,
    )
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] flex flex-col bg-surface-raised rounded-t-2xl overflow-hidden shadow-2xl animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-surface-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border flex-shrink-0">
          <h2 className="font-display font-bold text-lg text-tx-primary">Edit Saved Food</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-muted transition-colors">
            <X className="w-5 h-5 text-tx-muted" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="p-4 space-y-4 pb-32">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 px-3.5 py-3 text-xs text-error-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Photo card */}
            <div className="card overflow-hidden">
              <div className="relative">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={name}
                    className="w-full h-44 object-cover"
                    onError={() => setImageUrl('')}
                  />
                ) : (
                  <div className="w-full h-44 bg-surface-muted flex flex-col items-center justify-center gap-2">
                    <Utensils className="w-10 h-10 text-tx-muted opacity-20" />
                    <p className="text-xs text-tx-muted">No photo yet</p>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex items-end p-3 gap-2">
                  <button
                    onClick={() => setCameraMode('food-photo')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white text-xs font-medium hover:bg-white/20 transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Take photo
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white text-xs font-medium hover:bg-white/20 transition-colors"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    Upload
                  </button>
                  <button
                    onClick={() => setCameraMode('label-scan')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white text-xs font-medium hover:bg-white/20 transition-colors ml-auto"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Scan label
                  </button>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </div>

            {/* Name + Brand + Serving */}
            <div className="card p-4 space-y-3">
              <div>
                <label className="label mb-1.5 block">Food Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Greek Yogurt" className="input w-full" maxLength={200} />
              </div>
              <div>
                <label className="label mb-1.5 block">Brand <span className="text-tx-muted font-normal">(optional)</span></label>
                <input type="text" value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Chobani" className="input w-full" maxLength={200} />
              </div>
              <div>
                <label className="label mb-1.5 block">Serving Size</label>
                <input type="text" value={servingSize} onChange={e => setServingSize(e.target.value)} placeholder="e.g. 1 cup (227g)" className="input w-full" maxLength={100} />
              </div>
            </div>

            {/* Macros */}
            <div className="card p-4 space-y-3">
              <p className="label">Nutrition (per serving)</p>
              <div className="grid grid-cols-2 gap-2.5">
                {MACRO_FIELDS.map(f => {
                  const val = f.key === 'calories' ? calories : f.key === 'protein' ? protein : f.key === 'carbs' ? carbs : f.key === 'fat' ? fat
                    : f.key === 'fiber' ? fiber : f.key === 'sugar' ? sugar : f.key === 'sodium' ? sodium : cholesterol
                  const setter = f.key === 'calories' ? setCalories : f.key === 'protein' ? setProtein : f.key === 'carbs' ? setCarbs : f.key === 'fat' ? setFat
                    : f.key === 'fiber' ? setFiber : f.key === 'sugar' ? setSugar : f.key === 'sodium' ? setSodium : setCholesterol
                  return (
                    <div key={f.key} className="space-y-1">
                      <label className={`text-xs font-medium ${f.color}`}>{f.label}</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          step={f.key === 'calories' ? 1 : 0.1}
                          value={val}
                          onChange={e => setter(Number(e.target.value) || 0)}
                          className="input w-full pr-10 tabular-nums"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-tx-muted pointer-events-none">{f.unit}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Delete */}
            <div className="card p-4">
              {confirmDelete ? (
                <div className="space-y-3">
                  <p className="text-sm text-tx-secondary text-center">Remove <span className="font-semibold text-tx-primary">{name}</span> from My Foods?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDelete(false)} className="btn-secondary flex-1">Cancel</button>
                    <button onClick={handleDelete} disabled={deleting} className="btn-danger-solid flex-1 disabled:opacity-50">
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-2 text-error-400 hover:text-error-300 transition-colors text-sm font-medium w-full justify-center py-1"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove from My Foods
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sticky save */}
        <div className="flex-shrink-0 p-4 border-t border-surface-border bg-surface-raised safe-area-bottom">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="btn-primary btn-lg w-full disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved
              ? <span className="flex items-center justify-center gap-2"><Check className="w-4 h-4" /> Saved!</span>
              : 'Save Changes'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── FoodPhotoCapture — camera view for taking a plain food photo ─────────────

function FoodPhotoCapture({ onCapture, onClose }: { onCapture: (url: string) => void; onClose: () => void }) {
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
      <p className="text-white/60 text-xs text-center">Frame the food, then tap to capture</p>
      <button
        onClick={capture}
        className="w-16 h-16 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Capture food photo"
      >
        <Camera className="w-6 h-6 text-black" />
      </button>
    </div>
  )
}
