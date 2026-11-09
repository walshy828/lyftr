import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import FoodAvatar from '../ui/FoodAvatar'
import { foodAPI } from '../../services/api'
import { downscaleToJpeg } from '../../utils/image'
import * as types from '../../types'

interface Props {
  entry: types.FoodLog
  size?: 'sm' | 'md' | 'lg'
  className?: string
  onChanged: (updated: types.FoodLog) => void
  onError?: (msg: string) => void
}

/**
 * A food's picture that you can tap to replace. The photo is applied to this
 * entry and, server-side, to every other entry and saved food for the same
 * food — so you photograph your usual yogurt once and it's pictured everywhere.
 */
export default function FoodPhotoButton({ entry, size = 'md', className = '', onChanged, onError }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onPick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const { base64 } = await downscaleToJpeg(file, 800)
      const { image_url } = await foodAPI.uploadPhoto(base64)
      onChanged(await foodAPI.setPhoto(entry.id, image_url))
    } catch {
      onError?.(`Couldn't save a photo for ${entry.name}`)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <>
    <button
      type="button"
      onClick={() => input.current?.click()}
      aria-label={entry.image_url ? `Change photo of ${entry.name}` : `Add a photo of ${entry.name}`}
      className={`relative group flex-shrink-0 rounded-xl ${className}`}
    >
      <FoodAvatar food={entry} size={size} />
      <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-surface-raised border border-surface-border flex items-center justify-center transition-opacity ${
        busy || !entry.image_url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin text-tx-muted" /> : <Camera className="w-3 h-3 text-tx-muted" />}
      </span>
    </button>
    <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onPick(e.target.files?.[0])} />
    </>
  )
}
