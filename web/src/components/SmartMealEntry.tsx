import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertCircle, Sparkles } from 'lucide-react'
import { foodAPI } from '../services/api'
import * as types from '../types'

interface Props {
  onResult: (items: types.MealItem[]) => void
  onClose: () => void
}

const EXAMPLE = 'e.g. "turkey sandwich with 2 pieces of turkey, honey wheat bread, and mayonnaise, with a can of ginger ale"'

export default function SmartMealEntry({ onResult, onClose }: Props) {
  const [description, setDescription] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const submit = async () => {
    const trimmed = description.trim()
    if (!trimmed || parsing) return
    setParsing(true)
    setError(null)
    try {
      const { items } = await foodAPI.parseMeal(trimmed)
      if (!items || items.length === 0) {
        setError("Couldn't find any food items in that — try rephrasing")
        return
      }
      onResult(items)
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
    <div className="fixed inset-0 z-50 bg-surface-base flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-surface-border">
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

      <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
        <textarea
          ref={textareaRef}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={EXAMPLE}
          rows={6}
          maxLength={1000}
          className="input flex-1 min-h-[8rem] resize-none text-base"
        />
        <p className="text-xs text-tx-muted">
          Describe everything you ate and roughly how much — Lyftr will split it into items you can review before logging.
        </p>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 px-3.5 py-3 text-xs text-error-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-surface-border safe-area-bottom">
        <button
          onClick={submit}
          disabled={!description.trim() || parsing}
          className="btn-primary btn-lg w-full"
        >
          {parsing ? 'Parsing…' : 'Parse meal'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
