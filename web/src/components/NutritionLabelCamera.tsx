import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertCircle, Camera } from 'lucide-react'
import { foodAPI } from '../services/api'
import * as types from '../types'

interface Props {
  onResult: (extraction: types.NutritionExtraction) => void
  onImageCapture?: (dataUrl: string) => void
  onClose: () => void
}

const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 0.85

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export default function NutritionLabelCamera({ onResult, onImageCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraError, setCameraError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch((err: any) => setCameraError(err?.message ?? String(err)))

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const capture = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || capturing) return

    const { videoWidth, videoHeight } = video
    if (!videoWidth || !videoHeight) return

    const longEdge = Math.max(videoWidth, videoHeight)
    const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
    canvas.width = Math.round(videoWidth * scale)
    canvas.height = Math.round(videoHeight * scale)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    setCapturing(true)
    setAnalyzeError(null)
    try {
      const blob: Blob | null = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
      )
      if (!blob) throw new Error('capture failed')
      // Emit the data URL for callers that want to display the photo
      if (onImageCapture) {
        onImageCapture(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      }
      const buffer = await blob.arrayBuffer()
      const base64 = arrayBufferToBase64(buffer)
      const extraction = await foodAPI.analyzeLabel(base64, 'image/jpeg')
      onResult(extraction)
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setAnalyzeError(err?.response?.data?.error || 'Label scanning is unavailable right now')
      } else {
        setAnalyzeError('Could not analyze this image — try again or enter manually')
      }
    } finally {
      setCapturing(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex items-center justify-between p-4">
        <p className="text-white text-sm font-medium">Scan nutrition label</p>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Close camera"
        >
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center relative">
        {!cameraError && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full max-w-sm rounded-lg"
            style={{ maxHeight: '60vh', objectFit: 'cover' }}
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {analyzeError && (
        <div className="flex items-center gap-2 mx-4 mb-3 rounded-xl border border-error-500/20 bg-error-500/10 px-3.5 py-3 text-xs text-error-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {analyzeError}
        </div>
      )}

      {cameraError ? (
        <div className="flex flex-col items-center gap-3 px-6 pb-10 text-center">
          <AlertCircle className="w-8 h-8 text-error-400" />
          <p className="text-white text-sm font-medium">Camera unavailable</p>
          <p className="text-white/50 text-xs font-mono break-all">{cameraError}</p>
          <button onClick={onClose} className="btn-primary btn-sm mt-2">
            Enter manually instead
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 pb-10 px-4">
          <p className="text-center text-white/60 text-xs">
            Frame the nutrition facts label, then tap to capture
          </p>
          <button
            onClick={capture}
            disabled={capturing}
            className="w-16 h-16 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
            aria-label="Capture photo"
          >
            <Camera className="w-6 h-6 text-black" />
          </button>
          {capturing && <p className="text-white/60 text-xs">Analyzing…</p>}
        </div>
      )}
    </div>,
    document.body,
  )
}
