import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertCircle, Sparkles, Mic, MicOff, Camera } from 'lucide-react'
import { foodAPI } from '../services/api'
import IconButton from './ui/IconButton'
import * as types from '../types'

interface Props {
  onTextResult: (items: types.MealItem[]) => void
  onPhotoResult: (analysis: types.MealPhotoAnalysis) => void
  onClose: () => void
}

const EXAMPLE = 'e.g. "turkey sandwich with 2 pieces of turkey, honey wheat bread, and mayonnaise, with a can of ginger ale"'

const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition

const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 0.85

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Downscales an in-memory image (from a picked/captured file) to a JPEG
// data URL + base64 payload, mirroring NutritionLabelCamera's canvas
// pipeline so both photo entry points send the same shape of image.
async function downscaleToJpeg(file: File): Promise<{ dataUrl: string; base64: string }> {
  const bitmap = await createImageBitmap(file)
  const longEdge = Math.max(bitmap.width, bitmap.height)
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('image encode failed')
  const buffer = await blob.arrayBuffer()
  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), base64: arrayBufferToBase64(buffer) }
}

export default function SmartMealEntry({ onTextResult, onPhotoResult, onClose }: Props) {
  const [description, setDescription] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoBase64, setPhotoBase64] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => () => recognitionRef.current?.stop(), [])

  // On mobile, `position: fixed` sizes against the layout viewport, not the
  // visual one — so when the keyboard opens, the browser doesn't shrink this
  // container and the footer button ends up hidden behind the keyboard.
  // Track the visual viewport directly so the modal (and its flex children)
  // resize to the actually-visible area as the keyboard opens/closes.
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setViewport({ height: vv.height, top: vv.offsetTop })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  const toggleListening = () => {
    if (!SpeechRecognitionCtor) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = navigator.language || 'en-US'
    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) transcript += event.results[i][0].transcript
      }
      if (transcript.trim()) {
        setDescription(d => (d.trim() ? `${d.trim()} ${transcript.trim()}` : transcript.trim()))
      }
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  const handlePhotoPicked = async (file: File | null) => {
    if (!file) return
    try {
      const { dataUrl, base64 } = await downscaleToJpeg(file)
      setPhotoPreview(dataUrl)
      setPhotoBase64(base64)
      setError(null)
    } catch {
      setError('Could not read that photo — try again')
    }
  }

  const removePhoto = () => {
    setPhotoPreview(null)
    setPhotoBase64(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const submit = async () => {
    const trimmed = description.trim()
    if ((!trimmed && !photoBase64) || parsing) return
    setParsing(true)
    setError(null)
    try {
      if (photoBase64) {
        const analysis = await foodAPI.analyzeMealPhoto(photoBase64, 'image/jpeg', trimmed)
        if (!analysis.items || analysis.items.length === 0) {
          setError("Couldn't find any food items in that photo — try a clearer shot or add a description")
          return
        }
        onPhotoResult(analysis)
      } else {
        const { items } = await foodAPI.parseMeal(trimmed)
        if (!items || items.length === 0) {
          setError("Couldn't find any food items in that — try rephrasing")
          return
        }
        onTextResult(items)
      }
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setError(err?.response?.data?.error || 'Smart food entry is unavailable right now')
      } else {
        setError('Could not parse that meal — try again or enter manually')
      }
    } finally {
      setParsing(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 bottom-0 z-50 bg-surface-base flex flex-col"
      style={viewport ? { top: viewport.top, height: viewport.height, bottom: 'auto' } : undefined}
    >
      <div className="flex items-center justify-between p-3 border-b border-surface-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-500" />
          <p className="text-sm font-semibold text-tx-primary">Describe your meal</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-surface-muted transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-tx-muted" />
        </button>
      </div>

      <div className="flex-1 flex flex-col p-3 gap-2 overflow-y-auto min-h-0">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={e => handlePhotoPicked(e.target.files?.[0] ?? null)}
        />

        {photoPreview ? (
          <div className="relative flex-shrink-0">
            <img src={photoPreview} alt="Meal photo" className="w-full max-h-48 object-cover rounded-xl" />
            <button
              onClick={removePhoto}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 transition-colors"
              aria-label="Remove photo"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 flex items-center justify-center gap-2 rounded-xl border border-dashed border-surface-border text-tx-secondary hover:text-tx-primary hover:border-brand-500/40 py-3 text-sm font-medium transition-colors"
          >
            <Camera className="w-4 h-4" />
            Add a photo of your meal
          </button>
        )}

        <div className="relative flex-1 min-h-[4.5rem]">
          <textarea
            ref={textareaRef}
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={EXAMPLE}
            enterKeyHint="send"
            rows={4}
            maxLength={1000}
            className={`input h-full w-full resize-none text-base ${SpeechRecognitionCtor ? 'pr-12' : ''}`}
          />
          {SpeechRecognitionCtor && (
            <IconButton
              icon={listening ? MicOff : Mic}
              label={listening ? 'Stop voice input' : 'Describe your meal by voice'}
              onClick={toggleListening}
              variant={listening ? 'danger' : 'brand'}
              size="md"
              className={`absolute bottom-2.5 right-2.5 ${listening ? 'animate-pulse' : ''}`}
            />
          )}
        </div>
        {(listening || !description.trim()) && (
          <p className="text-xs text-tx-muted flex-shrink-0">
            {listening
              ? 'Listening… speak your meal, then tap the mic again.'
              : photoBase64
                ? 'Optionally add details the photo might miss, like dressing or extra sides.'
                : 'Describe everything you ate and roughly how much, or add a photo — Lyftr will split it into items you can review before logging.'}
          </p>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 px-3.5 py-3 text-xs text-error-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-surface-border safe-area-bottom flex-shrink-0">
        <button
          onClick={submit}
          disabled={(!description.trim() && !photoBase64) || parsing}
          className="btn-primary btn-lg w-full"
        >
          {parsing ? 'Analyzing…' : photoBase64 ? 'Analyze photo' : 'Parse meal'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
