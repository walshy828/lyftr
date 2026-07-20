import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertCircle, Sparkles, Mic, MicOff } from 'lucide-react'
import { foodAPI } from '../services/api'
import IconButton from './ui/IconButton'
import * as types from '../types'

interface Props {
  onResult: (items: types.MealItem[]) => void
  onClose: () => void
}

const EXAMPLE = 'e.g. "turkey sandwich with 2 pieces of turkey, honey wheat bread, and mayonnaise, with a can of ginger ale"'

const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition

export default function SmartMealEntry({ onResult, onClose }: Props) {
  const [description, setDescription] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => () => recognitionRef.current?.stop(), [])

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
        <div className="relative flex-1 min-h-[8rem]">
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
            rows={6}
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
        <p className="text-xs text-tx-muted">
          {listening
            ? 'Listening… speak your meal, then tap the mic again.'
            : 'Describe everything you ate and roughly how much — Lyftr will split it into items you can review before logging.'}
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
