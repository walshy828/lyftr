import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertCircle, Sparkles, RefreshCw, Check } from 'lucide-react'
import { foodAPI } from '../services/api'
import { dayToIsoNoon } from '../utils/dateUtils'
import * as types from '../types'

interface Props {
  meal: types.FoodLog['meal']
  mealLabel: string
  date: string // YYYY-MM-DD
  onLogged: () => void
  onClose: () => void
}

const sumMacro = (items: types.MealItem[], key: 'calories' | 'protein' | 'carbs' | 'fat') =>
  Math.round(items.reduce((sum, i) => sum + (i[key] ?? 0), 0))

export default function MealRecommendations({ meal, mealLabel, date, onLogged, onClose }: Props) {
  const [recommendations, setRecommendations] = useState<types.MealRecommendation[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loggingIndex, setLoggingIndex] = useState<number | null>(null)
  const [logError, setLogError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const fetchRecommendations = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLogError(null)
    try {
      const { recommendations } = await foodAPI.recommend(meal, date)
      if (!recommendations || recommendations.length === 0) {
        setError("Couldn't come up with suggestions — try again")
        setRecommendations(null)
        return
      }
      setRecommendations(recommendations)
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setError(err?.response?.data?.error || 'Meal recommendations are unavailable right now')
      } else {
        setError('Could not generate recommendations — try again')
      }
      setRecommendations(null)
    } finally {
      setLoading(false)
    }
  }, [meal, date])

  useEffect(() => { fetchRecommendations() }, [fetchRecommendations])

  const logRecommendation = async (rec: types.MealRecommendation, index: number) => {
    if (loggingIndex !== null) return
    setLoggingIndex(index)
    setLogError(null)
    try {
      await Promise.all(rec.items.map(item => foodAPI.log({
        name: item.name || 'Custom entry',
        meal,
        calories: +(item.calories ?? 0).toFixed(1),
        protein: +(item.protein ?? 0).toFixed(1),
        carbs: +(item.carbs ?? 0).toFixed(1),
        fat: +(item.fat ?? 0).toFixed(1),
        fiber: +(item.fiber ?? 0).toFixed(1),
        sugar: +(item.sugar ?? 0).toFixed(1),
        sodium: +(item.sodium ?? 0).toFixed(1),
        cholesterol: +(item.cholesterol ?? 0).toFixed(1),
        servings: 1,
        serving_size: item.serving_size ?? item.quantity ?? '',
        source: 'ai',
        logged_at: dayToIsoNoon(date),
      })))
      onLogged()
    } catch {
      setLogError('Failed to log one or more items — try again')
      setLoggingIndex(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-surface-base flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-500" />
          <p className="text-sm font-semibold text-tx-primary">{mealLabel} ideas</p>
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
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-tx-muted">
            <Sparkles className="w-6 h-6 animate-pulse text-brand-500" />
            <p className="text-sm">Thinking of ideas that fit your remaining goals…</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 px-3.5 py-3 text-xs text-error-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
            <button onClick={fetchRecommendations} className="btn-secondary btn-sm">
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : (
          <>
            {logError && (
              <div className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 px-3.5 py-3 text-xs text-error-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {logError}
              </div>
            )}
            {recommendations?.map((rec, index) => (
              <div key={index} className="card p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-tx-primary">{rec.title}</p>
                  <p className="text-xs text-tx-muted mt-0.5">{rec.description}</p>
                </div>

                <div className="divide-y divide-surface-border rounded-xl border border-surface-border">
                  {rec.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-tx-primary truncate">{item.name}</p>
                        {item.quantity && <p className="text-[10px] text-tx-muted">{item.quantity}</p>}
                      </div>
                      <span className="text-xs tabular-nums flex-shrink-0 text-right">
                        <span className="text-tx-secondary">{Math.round(item.calories)} kcal</span>
                        <span className="text-emerald-400"> · {Math.round(item.protein)}g P</span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap text-xs tabular-nums">
                  <span className="font-semibold text-tx-secondary">{sumMacro(rec.items, 'calories')} kcal</span>
                  <span className="text-[10px] text-tx-muted">·</span>
                  <span className="text-emerald-400">{sumMacro(rec.items, 'protein')}g P</span>
                  <span className="text-[10px] text-tx-muted">·</span>
                  <span className="text-amber-400">{sumMacro(rec.items, 'carbs')}g C</span>
                  <span className="text-[10px] text-tx-muted">·</span>
                  <span className="text-violet-400">{sumMacro(rec.items, 'fat')}g F</span>
                </div>

                <button
                  onClick={() => logRecommendation(rec, index)}
                  disabled={loggingIndex !== null}
                  className="btn-primary btn-sm w-full"
                >
                  <Check className="w-3.5 h-3.5" />
                  {loggingIndex === index ? 'Logging…' : 'Log this meal'}
                </button>
              </div>
            ))}
            <p className="text-[10px] text-tx-muted text-center">
              AI suggestions with estimated nutrition — double-check for allergens and accuracy.
            </p>
          </>
        )}
      </div>

      {!loading && !error && (
        <div className="p-4 border-t border-surface-border safe-area-bottom">
          <button
            onClick={fetchRecommendations}
            disabled={loggingIndex !== null}
            className="btn-secondary btn-lg w-full"
          >
            <RefreshCw className="w-4 h-4" /> More ideas
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
