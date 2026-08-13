import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Search, X,
  Bookmark, BookmarkCheck, AlertCircle, Utensils, Zap,
  Coffee, Sun, Moon, Cookie, ChevronRight, Camera, Pencil,
  Plus, Sparkles,
} from 'lucide-react'
import { foodAPI, savedFoodsAPI } from '../services/api'
import { todayStr, dayToIsoNoon } from '../utils/dateUtils'
import { MACRO_COLORS } from '../utils/macroColors'
import { filterFoods, normalizeFoodName } from '../utils/foodMatch'
import {
  buildUnitOptions, findUnit, amountToServings, formatServingLabel,
  matchUnitForLabel, SERVING_UNIT_ID, type UnitOption,
} from '../utils/portions'
import BarcodeScanner from '../components/BarcodeScanner'
import NutritionLabelCamera from '../components/NutritionLabelCamera'
import SmartMealEntry from '../components/SmartMealEntry'
import EditSavedFoodSheet from '../components/EditSavedFoodSheet'
import MealItemEditCard, { type EditableMealItem } from '../components/MealItemEditCard'
import FoodCaptureBar from '../components/food/FoodCaptureBar'
import SourceBadge from '../components/food/SourceBadge'
import SourceFilter from '../components/food/SourceFilter'
import { foodSourceBadge } from '../utils/foodSource'
import { useSettingsStore } from '../stores/settings'
import PortionPicker from '../components/food/PortionPicker'
import ServingEditor from '../components/food/ServingEditor'
import SegmentedControl from '../components/ui/SegmentedControl'
import DateInput from '../components/ui/DateInput'
import AuthedImg from '../components/ui/AuthedImg'
import * as types from '../types'

type Phase = 'search' | 'detail' | 'scan' | 'scan-label' | 'smart' | 'smart-review' | 'photo-review'
// Which sections of the unified result list are shown. Not a mode: the query
// always filters your own foods and always searches the database, so these only
// narrow what's already on screen.
type SearchFilter = 'all' | 'recent' | 'myfoods' | 'database'

type ReviewItem = EditableMealItem
type PhotoReviewItem = types.MealPhotoItem & {
  servings: number
  include: boolean
  // Set when the user swaps in a database label — same contract as
  // EditableMealItem, so the shared edit card can patch either kind.
  source?: types.FoodSearchResult['source']
  label_accurate?: boolean
}

const DEFAULT_SOURCES: types.FoodSource[] = ['off', 'fdc']

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const
const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks',
}
const MEAL_ICONS: Record<string, React.ElementType> = {
  breakfast: Coffee, lunch: Sun, dinner: Moon, snacks: Cookie,
}
const MEAL_COLORS: Record<string, string> = {
  breakfast: 'text-amber-400', lunch: 'text-yellow-400',
  dinner: 'text-indigo-400', snacks: 'text-pink-400',
}

function entryToResult(e: types.FoodLog): types.FoodSearchResult {
  const s = e.servings || 1
  return {
    name: e.name,
    brand: e.brand,
    calories: e.calories / s,
    protein: e.protein / s,
    carbs: e.carbs / s,
    fat: e.fat / s,
    fiber: (e.fiber ?? 0) / s,
    sugar: (e.sugar ?? 0) / s,
    sodium: (e.sodium ?? 0) / s,
    cholesterol: (e.cholesterol ?? 0) / s,
    serving_size: e.serving_size ?? '',
    serving_size_grams: e.serving_size_grams,
    image_url: e.image_url,
    barcode: e.barcode,
    // label_accurate is deliberately not inferred here: a stored entry records
    // which source it came from, not whether that source quoted a real panel,
    // and claiming a label we can't prove is worse than claiming nothing.
    source: (e.source as types.FoodSearchResult['source']) || 'saved',
  }
}

function savedToResult(s: types.SavedFood): types.FoodSearchResult {
  return {
    name: s.name, brand: s.brand,
    calories: s.calories, protein: s.protein, carbs: s.carbs,
    fat: s.fat, fiber: s.fiber, sugar: s.sugar, sodium: s.sodium, cholesterol: s.cholesterol,
    serving_size: s.serving_size,
    serving_size_grams: s.serving_size_grams,
    image_url: s.image_url, source: 'saved',
  }
}

/** A blank food, ready for hand entry. */
function manualResult(name = ''): types.FoodSearchResult {
  return {
    name, calories: 0, protein: 0, carbs: 0, fat: 0,
    fiber: 0, sugar: 0, sodium: 0, cholesterol: 0,
    serving_size: '1 serving', source: 'manual',
  }
}

/**
 * Picks the amount + unit to open the portion picker on. For a food with a
 * gram basis this restores the unit the entry was saved with (so editing
 * "1 tbsp" doesn't reopen as "0.14 servings"); otherwise the servings
 * multiplier is the amount, matching the old stepper.
 */
function initPortion(result: types.FoodSearchResult, servings: number): { amount: number; unitId: string } {
  const options = buildUnitOptions(result)
  const basis = result.serving_size_grams ?? 0
  if (basis <= 0) return { amount: servings, unitId: SERVING_UNIT_ID }

  const unit = matchUnitForLabel(options, result.serving_size)
  if (unit.id === SERVING_UNIT_ID) return { amount: servings, unitId: SERVING_UNIT_ID }
  return { amount: +((servings * basis) / unit.grams).toFixed(2), unitId: unit.id }
}

/** Divider naming where the rows beneath it came from. */
function SectionHeader({ label, busy = false }: { label: string; busy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 bg-surface-muted/60 border-b border-surface-border">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{label}</span>
      {busy && <span className="text-[10px] text-tx-muted">Searching…</span>}
    </div>
  )
}

function FoodResultRow({ item, onClick }: { item: types.FoodSearchResult; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3.5 hover:bg-surface-muted active:bg-surface-muted/80 transition-colors border-b border-surface-border last:border-0 text-left"
    >
      <AuthedImg
        src={item.image_url}
        alt=""
        className="w-11 h-11 rounded-xl object-cover flex-shrink-0 border border-surface-border"
        fallback={
          <div className="w-11 h-11 rounded-xl bg-surface-muted border border-surface-border flex items-center justify-center flex-shrink-0">
            <Utensils className="w-5 h-5 text-tx-muted" />
          </div>
        }
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-semibold text-tx-primary truncate">{item.name}</p>
          <SourceBadge item={item} className="flex-shrink-0" />
        </div>
        {item.brand && <p className="text-xs text-tx-muted truncate mt-0.5">{item.brand}</p>}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-xs font-semibold text-tx-secondary tabular-nums">{Math.round(item.calories)} kcal</span>
          <span className="text-[10px] text-tx-muted">·</span>
          <span className="text-xs text-emerald-400 tabular-nums">{item.protein.toFixed(0)}g P</span>
          <span className="text-[10px] text-tx-muted">·</span>
          <span className="text-xs text-amber-400 tabular-nums">{item.carbs.toFixed(0)}g C</span>
          <span className="text-[10px] text-tx-muted">·</span>
          <span className="text-xs text-violet-400 tabular-nums">{item.fat.toFixed(0)}g F</span>
          {item.serving_size && (
            <>
              <span className="text-[10px] text-tx-muted">·</span>
              <span className="text-[10px] text-tx-muted">{item.serving_size}</span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-tx-muted flex-shrink-0" />
    </button>
  )
}

export default function LogFood() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const editId = searchParams.get('edit') ? Number(searchParams.get('edit')) : null
  const initMeal = (searchParams.get('meal') ?? 'breakfast') as types.FoodLog['meal']
  const initDate = searchParams.get('date') ?? todayStr()

  const [phase, setPhase] = useState<Phase>('search')
  const [filter, setFilter] = useState<SearchFilter>('all')
  // Which upstream databases to query. Persisted client-side, so the choice
  // survives leaving and coming back to the search. The fallback is a module
  // constant, not an inline literal: this value is a search effect dependency,
  // and a fresh array every render would re-run the search forever.
  const sources = useSettingsStore(s => s.settings.food_search_sources) ?? DEFAULT_SOURCES
  const setSources = useSettingsStore(s => s.setFoodSearchSources)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<types.FoodSearchResult[]>([])
  const [recentItems, setRecentItems] = useState<types.FoodSearchResult[]>([])
  const [recentError, setRecentError] = useState(false)
  const [savedFoods, setSavedFoods] = useState<types.SavedFood[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [rateLimited, setRateLimited] = useState(false)

  const [selected, setSelected] = useState<types.FoodSearchResult | null>(null)
  // Portion state. `servings` — the multiplier the API stores and every macro
  // is scaled by — is derived from these, so the amount the user typed stays
  // the source of truth and the stored value is always consistent with it.
  const [amount, setAmount] = useState(1)
  const [unitId, setUnitId] = useState<string>(SERVING_UNIT_ID)
  const [meal, setMeal] = useState<types.FoodLog['meal']>(initMeal)
  const [date, setDate] = useState(initDate)
  // Pre-qualified items (My Foods / Recent) get a stripped-down quick-log detail
  // view; search / scan / manual / edit keep the full editable review.
  const [condensed, setCondensed] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [saveToMyFoods, setSaveToMyFoods] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [capturedImageUrl, setCapturedImageUrl] = useState<string>('')
  const [editingSavedFood, setEditingSavedFood] = useState<types.SavedFood | null>(null)
  const [mealItems, setMealItems] = useState<ReviewItem[]>([])
  const [loggingMealItems, setLoggingMealItems] = useState(false)
  const [mealLogError, setMealLogError] = useState<string | null>(null)
  const [photoAnalysis, setPhotoAnalysis] = useState<types.MealPhotoAnalysis | null>(null)
  const [photoReviewItems, setPhotoReviewItems] = useState<PhotoReviewItem[]>([])
  const [loggingPhotoItems, setLoggingPhotoItems] = useState(false)
  const [photoLogError, setPhotoLogError] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editId) return
    foodAPI.get(editId).then(entry => {
      const result = entryToResult(entry)
      const portion = initPortion(result, entry.servings || 1)
      setSelected(result)
      setAmount(portion.amount)
      setUnitId(portion.unitId)
      setMeal(entry.meal)
      setDate(entry.logged_at.slice(0, 10))
      setPhase('detail')
    }).catch(() => navigate('/food', { replace: true }))
  }, [editId, navigate])

  useEffect(() => {
    // "Recent" = frequently-used go-to foods across history (already deduped and
    // ranked server-side), not just today's logs — so daily staples like coffee
    // are one tap away even on a fresh day.
    foodAPI.recent().then(items => {
      setRecentItems((items || []).slice(0, 15).map(entryToResult))
      setRecentError(false)
    }).catch(() => setRecentError(true))
    savedFoodsAPI.list().then(setSavedFoods).catch(() => {})
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setSearchResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      setRateLimited(false)
      try {
        setSearchResults(await foodAPI.search(query.trim(), 20, sources) ?? [])
      } catch (err: any) {
        if (err?.response?.status === 429) setRateLimited(true)
        else setSearchError(err?.response?.data?.error || 'Food search unavailable — enter details manually')
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // Re-runs when the source selection changes, so toggling a source updates
    // the list in place instead of waiting for the next keystroke.
  }, [query, sources])

  const selectResult = (result: types.FoodSearchResult, quick = false) => {
    const portion = initPortion(result, 1)
    setSelected(result)
    setAmount(portion.amount)
    setUnitId(portion.unitId)
    setCondensed(quick)
    setShowDate(false)
    setPhase('detail')
  }

  /** Opens the full detail form on a blank food, optionally pre-named from the query. */
  const startManual = (name = '') => selectResult(manualResult(name.trim()))

  const handleBarcodeResult = async (code: string) => {
    setPhase('search')
    try {
      selectResult(await foodAPI.barcode(code))
    } catch (err: any) {
      if (err?.response?.status === 404) {
        // Neither database has this product. The package is still in the
        // user's hand, so send them to the label camera rather than a blank
        // form — photographing the real panel beats typing it, and beats an
        // AI estimate of a product nobody has data for. The scanned code is
        // kept so the finished entry still records what was scanned, and
        // manual entry stays one tap away from the label screen.
        setSelected({ ...manualResult(), barcode: code })
        setAmount(1)
        setUnitId(SERVING_UNIT_ID)
        setCondensed(false)
        setPhase('scan-label')
      } else {
        setSearchError('Product not found — enter details manually')
      }
    }
  }

  const handleMealParsed = (items: types.MealItem[]) => {
    setMealItems(items.map(item => ({ ...item, servings: 1, include: true })))
    setMealLogError(null)
    setPhase('smart-review')
  }

  const updateMealItem = (index: number, patch: Partial<ReviewItem>) => {
    setMealItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  const removeMealItem = (index: number) => {
    setMealItems(prev => prev.filter((_, i) => i !== index))
  }

  const handlePhotoAnalyzed = (analysis: types.MealPhotoAnalysis) => {
    setPhotoAnalysis(analysis)
    setPhotoReviewItems(analysis.items.map(item => ({ ...item, servings: 1, include: true })))
    setPhotoLogError(null)
    setPhase('photo-review')
  }

  const updatePhotoItem = (index: number, patch: Partial<PhotoReviewItem>) => {
    setPhotoReviewItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  const removePhotoItem = (index: number) => {
    setPhotoReviewItems(prev => prev.filter((_, i) => i !== index))
  }

  const handleLogPhotoItems = async () => {
    const toLog = photoReviewItems.filter(item => item.include)
    if (toLog.length === 0 || loggingPhotoItems || !photoAnalysis) return
    setLoggingPhotoItems(true)
    setPhotoLogError(null)
    try {
      await Promise.all(toLog.map(item => foodAPI.log({
        name: item.name || 'Custom entry',
        meal,
        calories: +(item.calories * item.servings).toFixed(1),
        protein: +(item.protein * item.servings).toFixed(1),
        carbs: +(item.carbs * item.servings).toFixed(1),
        fat: +(item.fat * item.servings).toFixed(1),
        fiber: +((item.fiber ?? 0) * item.servings).toFixed(1),
        sugar: +((item.sugar ?? 0) * item.servings).toFixed(1),
        sodium: +((item.sodium ?? 0) * item.servings).toFixed(1),
        cholesterol: +((item.cholesterol ?? 0) * item.servings).toFixed(1),
        servings: item.servings,
        serving_size: item.serving_size ?? item.quantity ?? '',
        image_url: photoAnalysis.image_url,
        // See handleLogMealItems: a looked-up label stops being an estimate.
        source: item.source ?? 'photo',
        logged_at: dayToIsoNoon(date),
      })))
      navigate('/food', { replace: true })
    } catch {
      setPhotoLogError('Failed to save one or more items — try again')
      setLoggingPhotoItems(false)
    }
  }

  const handleLogMealItems = async () => {
    const toLog = mealItems.filter(item => item.include)
    if (toLog.length === 0 || loggingMealItems) return
    setLoggingMealItems(true)
    setMealLogError(null)
    try {
      await Promise.all(toLog.map(item => foodAPI.log({
        name: item.name || 'Custom entry',
        meal,
        calories: +(item.calories * item.servings).toFixed(1),
        protein: +(item.protein * item.servings).toFixed(1),
        carbs: +(item.carbs * item.servings).toFixed(1),
        fat: +(item.fat * item.servings).toFixed(1),
        fiber: +((item.fiber ?? 0) * item.servings).toFixed(1),
        sugar: +((item.sugar ?? 0) * item.servings).toFixed(1),
        sodium: +((item.sodium ?? 0) * item.servings).toFixed(1),
        cholesterol: +((item.cholesterol ?? 0) * item.servings).toFixed(1),
        servings: item.servings,
        serving_size: item.serving_size ?? item.quantity ?? '',
        // An item the user replaced with a database label is no longer an AI
        // estimate, and shouldn't be badged as one in the diary.
        source: item.source ?? 'ai',
        logged_at: dayToIsoNoon(date),
      })))
      navigate('/food', { replace: true })
    } catch {
      setMealLogError('Failed to save one or more items — try again')
      setLoggingMealItems(false)
    }
  }

  // Handles both entry points: from the search phase (selected is null — seed a
  // fresh manual entry from the extraction) and an in-form rescan (selected is
  // already set — merge the extraction into it in place rather than replacing it,
  // so servings/meal/date the user already set are preserved).
  const handleLabelResult = (extraction: types.NutritionExtraction) => {
    setSelected(prev => {
      if (!prev) {
        return {
          name: extraction.name ?? '',
          brand: extraction.brand,
          calories: extraction.calories,
          protein: extraction.protein,
          carbs: extraction.carbs,
          fat: extraction.fat,
          fiber: extraction.fiber,
          sugar: extraction.sugar,
          sodium: extraction.sodium,
          cholesterol: extraction.cholesterol,
          serving_size: extraction.serving_size ?? '1 serving',
          source: 'photo',
        }
      }
      return {
        ...prev,
        name: extraction.name || prev.name,
        brand: extraction.brand || prev.brand,
        calories: extraction.calories,
        protein: extraction.protein,
        carbs: extraction.carbs,
        fat: extraction.fat,
        fiber: extraction.fiber,
        sugar: extraction.sugar,
        sodium: extraction.sodium,
        cholesterol: extraction.cholesterol,
        serving_size: extraction.serving_size || prev.serving_size,
        source: 'photo',
      }
    })
    if (!selected) { setAmount(1); setUnitId(SERVING_UNIT_ID) }
    setPhase('detail')
  }

  const handleLog = async () => {
    if (!selected || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        name: selected.name || 'Custom entry',
        brand: selected.brand ?? '',
        meal,
        calories: +(selected.calories * servings).toFixed(1),
        protein: +(selected.protein * servings).toFixed(1),
        carbs: +(selected.carbs * servings).toFixed(1),
        fat: +(selected.fat * servings).toFixed(1),
        fiber: +((selected.fiber ?? 0) * servings).toFixed(1),
        sugar: +((selected.sugar ?? 0) * servings).toFixed(1),
        sodium: +((selected.sodium ?? 0) * servings).toFixed(1),
        cholesterol: +((selected.cholesterol ?? 0) * servings).toFixed(1),
        // Store the entry against the unit the user actually chose: servings
        // counts those units, serving_size names one, and serving_size_grams is
        // one's mass. All three then describe the same thing, so re-opening
        // reads back as "2 × 1 tbsp" rather than "0.276 × per 100g" — and the
        // macro totals above, which are scaled by the derived multiplier, stay
        // exactly what was eaten either way.
        servings: amount,
        serving_size: unit.id === SERVING_UNIT_ID ? (selected.serving_size ?? '') : unit.label,
        serving_size_grams: unit.grams,
        image_url: selected.image_url ?? '',
        // Carrying the scanned code through means a logged entry can be matched
        // back to its product later — barcode was previously always empty,
        // since the lookup never returned the code it resolved.
        barcode: selected.barcode ?? '',
        source: selected.source,
        logged_at: dayToIsoNoon(date),
      }
      if (editId) {
        await foodAPI.update(editId, payload)
      } else {
        await foodAPI.log(payload)
        if (saveToMyFoods) {
          await savedFoodsAPI.create({
            name: selected.name, brand: selected.brand ?? '',
            calories: selected.calories, protein: selected.protein,
            carbs: selected.carbs, fat: selected.fat, fiber: selected.fiber ?? 0,
            serving_size: selected.serving_size ?? '',
            serving_size_grams: selected.serving_size_grams ?? 0,
            barcode: selected.barcode ?? '',
            image_url: capturedImageUrl,
          }).catch(() => {})
        }
      }
      navigate('/food', { replace: true })
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || 'Failed to save')
      setSaving(false)
    }
  }

  // Derived state — declared before the full-screen camera/AI phases return
  // early, so the hook order stays stable across every phase.

  // Your own foods filter instantly: they're already in memory, so narrowing
  // them needs no request and lands well before the database results do.
  const filteredRecent = useMemo(() => filterFoods(recentItems, query), [recentItems, query])
  const filteredSaved = useMemo(() => {
    const list = filterFoods(savedFoods, query)
    // A saved food that's also in Recent is the same food twice on screen;
    // Recent wins, since it carries the portion the user last actually logged.
    // Only while both sections share the list, though — under the My Foods
    // filter the user asked for their saved foods specifically, and dropping
    // one they just saved (because they also ate it this week) reads as the
    // save having failed.
    if (filter !== 'all') return list
    const recentNames = new Set(filteredRecent.map(r => normalizeFoodName(r.name)))
    return list.filter(sf => !recentNames.has(normalizeFoodName(sf.name)))
  }, [savedFoods, query, filteredRecent, filter])

  // Portion → servings. Every macro is scaled by `servings` exactly as before;
  // only the control the user drives it with has changed.
  const unitOptions: UnitOption[] = useMemo(
    () => selected ? buildUnitOptions(selected) : [{ id: SERVING_UNIT_ID, label: '1 serving', grams: 0 }],
    [selected],
  )

  // Clearing the serving's weight collapses the list back to the serving alone,
  // which can strand `unitId` on a g/oz/portion option that no longer exists.
  // `findUnit` falls back for display, but the state has to follow or the next
  // change re-selects the dead id.
  useEffect(() => {
    if (!unitOptions.some(o => o.id === unitId)) setUnitId(SERVING_UNIT_ID)
  }, [unitOptions, unitId])

  if (phase === 'scan') {
    return (
      <BarcodeScanner
        onResult={handleBarcodeResult}
        onClose={() => setPhase('search')}
      />
    )
  }

  if (phase === 'scan-label') {
    return (
      <NutritionLabelCamera
        onImageCapture={url => setCapturedImageUrl(url)}
        onResult={handleLabelResult}
        onClose={() => setPhase(selected ? 'detail' : 'search')}
      />
    )
  }

  if (phase === 'smart') {
    return (
      <SmartMealEntry
        onTextResult={handleMealParsed}
        onPhotoResult={handlePhotoAnalyzed}
        onClose={() => setPhase('search')}
      />
    )
  }

  const unit = findUnit(unitOptions, unitId)
  const servings = amountToServings(amount, unit, selected?.serving_size_grams ?? 0)

  const setPortion = (nextAmount: number, nextUnitId: string) => {
    setAmount(nextAmount)
    setUnitId(nextUnitId)
  }

  const setServing = (serving_size: string, serving_size_grams: number) => {
    setSelected(s => s && ({ ...s, serving_size, serving_size_grams }))
  }

  const cal = selected ? Math.round(selected.calories * servings) : 0
  const pro = selected ? +(selected.protein * servings).toFixed(1) : 0
  const carb = selected ? +(selected.carbs * servings).toFixed(1) : 0
  const fat_ = selected ? +(selected.fat * servings).toFixed(1) : 0
  const fib = selected ? +((selected.fiber ?? 0) * servings).toFixed(1) : 0
  const sug = selected ? +((selected.sugar ?? 0) * servings).toFixed(1) : 0
  const sod = selected ? +((selected.sodium ?? 0) * servings).toFixed(1) : 0
  const chol = selected ? +((selected.cholesterol ?? 0) * servings).toFixed(1) : 0
  const quickAddCals = /^\d+(\.\d+)?$/.test(query.trim()) ? Number(query.trim()) : null

  const showRecent = filter === 'all' || filter === 'recent'
  const showSaved = filter === 'all' || filter === 'myfoods'
  const showDatabase = filter === 'all' || filter === 'database'
  const yourFoodsCount = (showRecent ? filteredRecent.length : 0) + (showSaved ? filteredSaved.length : 0)

  // Macro inputs edit the displayed (servings-multiplied) total; back-solve the
  // per-serving base value stored on `selected` so the Servings stepper keeps working.
  const setMacro = (field: 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'sodium' | 'cholesterol', total: number) => {
    setSelected(s => s && ({ ...s, [field]: servings > 0 ? total / servings : total }))
  }

  return (
    <div className="animate-slide-up flex flex-col min-h-0">
      {/* Header with breadcrumb */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => (phase === 'detail' && !editId) || phase === 'smart-review' || phase === 'photo-review' ? setPhase('search') : navigate(-1)}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-surface-muted active:scale-95 transition-all flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5 text-tx-muted" />
        </button>
        <div className="flex-1 min-w-0">
          {phase === 'detail' && selected && condensed ? (
            // Compact header for pre-qualified items — name only, no breadcrumb /
            // editable fields, to keep the whole quick-log view on one screen.
            <>
              <h1 className="font-display font-bold text-xl text-tx-primary truncate">{selected.name || 'New Entry'}</h1>
              {selected.brand && <p className="text-xs text-tx-muted truncate">{selected.brand}</p>}
            </>
          ) : phase === 'detail' && selected ? (
            <>
              <div className="flex items-center gap-1.5 text-xs text-tx-muted mb-0.5">
                <span>{editId ? 'Edit Food' : 'Log Food'}</span>
                <ChevronRight className="w-3 h-3" />
                <span className="text-tx-secondary">Details</span>
              </div>
              <input
                type="text"
                value={selected.name}
                onChange={e => setSelected(s => s && ({ ...s, name: e.target.value }))}
                placeholder="Food name"
                className="font-display font-bold text-xl text-tx-primary bg-transparent border-0 border-b border-transparent hover:border-surface-border focus:border-brand-500 outline-none w-full truncate px-0 py-0.5"
              />
              <input
                type="text"
                value={selected.brand ?? ''}
                onChange={e => setSelected(s => s && ({ ...s, brand: e.target.value }))}
                placeholder="Brand (optional)"
                className="text-xs text-tx-muted bg-transparent border-0 border-b border-transparent hover:border-surface-border focus:border-brand-500 outline-none w-full mt-0.5 px-0 py-0.5"
              />
            </>
          ) : (
            <h1 className="font-display font-bold text-2xl text-tx-primary">Log Food</h1>
          )}
        </div>
      </div>

      {/* Search phase */}
      {phase === 'search' && (
        <div className="space-y-4">
          {/* Search — filters your own foods instantly and queries the food
              database in parallel; there is no mode to switch between. */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-tx-muted pointer-events-none" />
            <input
              ref={searchInputRef}
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your foods and the food database…"
              className="input pl-10 pr-10 w-full h-12 text-base"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); searchInputRef.current?.focus() }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-surface-muted flex items-center justify-center hover:bg-surface-overlay transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5 text-tx-muted" />
              </button>
            )}
          </div>

          <FoodCaptureBar
            onScanBarcode={() => setPhase('scan')}
            onScanLabel={() => setPhase('scan-label')}
            onDescribeMeal={() => setPhase('smart')}
            onAddManually={() => startManual(query)}
          />

          <SegmentedControl
            options={[
              { value: 'all', label: 'All' },
              { value: 'recent', label: 'Recent' },
              { value: 'myfoods', label: 'My Foods' },
              { value: 'database', label: 'Database' },
            ] as const}
            value={filter}
            onChange={setFilter}
          />

          {/* Only shown where it can act: the Recent and My Foods tabs are your
              own foods and never touch an upstream database. */}
          {(filter === 'all' || filter === 'database') && (
            <SourceFilter value={sources} onChange={setSources} className="px-1" />
          )}

          {/* Results — one list, sectioned by where each food came from */}
          <div className="card overflow-hidden">
            {quickAddCals !== null && (
              <button
                onClick={() => selectResult({ ...manualResult(`${quickAddCals} kcal`), calories: quickAddCals })}
                className="flex items-center gap-3 w-full px-4 py-3.5 hover:bg-surface-muted transition-colors border-b border-surface-border"
              >
                <div className="w-11 h-11 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-5 h-5 text-brand-500" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-semibold text-tx-primary">Quick add {quickAddCals} kcal</p>
                  <p className="text-xs text-tx-muted mt-0.5">No macro breakdown</p>
                </div>
                <ChevronRight className="w-4 h-4 text-tx-muted flex-shrink-0" />
              </button>
            )}

            {/* ─── Your foods ─── */}
            {yourFoodsCount > 0 && <SectionHeader label="Your foods" />}

            {showRecent && filteredRecent.map((item, i) => (
              <FoodResultRow
                key={`recent-${item.name}-${item.brand}-${item.calories}-${i}`}
                item={item}
                onClick={() => selectResult(item, true)}
              />
            ))}

            {showSaved && filteredSaved.map(sf => (
              <div key={sf.id} className="flex items-center border-b border-surface-border last:border-0">
                <button
                  className="flex items-center gap-3 flex-1 min-w-0 px-4 py-3.5 hover:bg-surface-muted active:bg-surface-muted/80 transition-colors text-left"
                  onClick={() => selectResult(savedToResult(sf), true)}
                >
                  <AuthedImg
                    src={sf.image_url}
                    alt=""
                    className="w-11 h-11 rounded-xl object-cover flex-shrink-0 border border-surface-border"
                    fallback={
                      <div className="w-11 h-11 rounded-xl bg-surface-muted border border-surface-border flex items-center justify-center flex-shrink-0">
                        <Utensils className="w-5 h-5 text-tx-muted" />
                      </div>
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-tx-primary truncate">{sf.name}</p>
                    {sf.brand && <p className="text-xs text-tx-muted truncate mt-0.5">{sf.brand}</p>}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs font-semibold text-tx-secondary tabular-nums">{Math.round(sf.calories)} kcal</span>
                      <span className="text-[10px] text-tx-muted">·</span>
                      <span className="text-xs text-emerald-400 tabular-nums">{sf.protein.toFixed(0)}g P</span>
                      <span className="text-[10px] text-tx-muted">·</span>
                      <span className="text-xs text-amber-400 tabular-nums">{sf.carbs.toFixed(0)}g C</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-tx-muted flex-shrink-0" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setEditingSavedFood(sf) }}
                  className="px-3 py-4 text-tx-muted hover:text-tx-primary transition-colors flex-shrink-0"
                  aria-label={`Edit ${sf.name}`}
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            ))}

            {yourFoodsCount === 0 && (showRecent || showSaved) && (
              <div className="px-4 py-8 text-center border-b border-surface-border">
                {recentError ? (
                  <p className="text-sm text-tx-muted">Couldn't load your recent foods</p>
                ) : query.trim() ? (
                  <p className="text-sm text-tx-muted">Nothing in your foods matches "{query.trim()}"</p>
                ) : (
                  <>
                    <Utensils className="w-8 h-8 text-tx-muted opacity-30 mx-auto mb-2" />
                    <p className="text-sm text-tx-muted">No go-to items yet</p>
                    <p className="text-xs text-tx-muted mt-1 opacity-60">Foods you log often show up here</p>
                  </>
                )}
              </div>
            )}

            {/* ─── Food database ─── */}
            {showDatabase && (
              <>
                <SectionHeader label="Food database" busy={searching && !!query.trim()} />

                {rateLimited && (
                  <p className="flex items-center gap-2 px-4 py-3 text-xs text-amber-400 border-b border-surface-border">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    Too many requests — wait a moment and try again
                  </p>
                )}
                {searchError && (
                  <p className="flex items-center gap-2 px-4 py-3 text-xs text-error-400 border-b border-surface-border">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {searchError}
                  </p>
                )}

                {!query.trim() && (
                  <p className="px-4 py-6 text-center text-xs text-tx-muted">
                    Type to search millions of foods
                  </p>
                )}
                {query.trim() && !searching && searchResults.length === 0 && !searchError && !rateLimited && (
                  <p className="px-4 py-6 text-center text-sm text-tx-muted">No results for "{query.trim()}"</p>
                )}
                {searchResults.map(item => (
                  <FoodResultRow
                    key={`db-${item.source}-${item.name}-${item.brand}-${item.calories}`}
                    item={item}
                    onClick={() => selectResult(item)}
                  />
                ))}
              </>
            )}

            {/* Always reachable, in every filter — hand entry is the fallback
                for everything the two sources between them can't answer. */}
            <button
              onClick={() => startManual(query)}
              className="flex items-center gap-3 w-full px-4 py-3.5 border-t border-surface-border hover:bg-surface-muted transition-colors text-left"
            >
              <div className="w-11 h-11 rounded-xl bg-surface-muted border border-surface-border flex items-center justify-center flex-shrink-0">
                <Plus className="w-5 h-5 text-tx-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-tx-primary truncate">
                  {query.trim() ? `Enter "${query.trim()}" manually` : 'Add a food manually'}
                </p>
                <p className="text-xs text-tx-muted mt-0.5">Type in the nutrition yourself</p>
              </div>
              <ChevronRight className="w-4 h-4 text-tx-muted flex-shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* Detail phase — full review (search / scan / manual / edit) */}
      {phase === 'detail' && selected && !condensed && (
        <div className="space-y-4 pb-32">
          {saveError && (
            <div className="alert-error">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Food hero + macros */}
          <div className="card overflow-hidden">
            {/* Image — captured photo takes priority, then image_url from search result */}
            {(capturedImageUrl || selected.image_url) ? (
              <div className="relative">
                <AuthedImg
                  src={capturedImageUrl || selected.image_url}
                  alt={selected.name}
                  className="w-full h-52 object-cover"
                  fallback={null}
                />
                <button
                  onClick={() => setCapturedImageUrl('')}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                  aria-label="Remove photo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="w-full h-32 bg-surface-muted border-b border-surface-border flex items-center justify-center">
                <Utensils className="w-10 h-10 text-tx-muted opacity-20" />
              </div>
            )}

            <div className="p-5">
              <div className="flex items-center justify-between gap-3 mb-2">
                {/* Where these numbers came from. An AI estimate and a
                    manufacturer's label look identical once they're both just
                    digits in a field, so say which this is before the user
                    commits it to their day. */}
                {(() => {
                  const badge = foodSourceBadge(selected)
                  if (!badge) return <span />
                  return (
                    <span className="flex items-center gap-1.5 min-w-0">
                      <SourceBadge item={selected} />
                      <span className="text-[10px] text-tx-muted truncate">
                        {badge.detail}
                        {selected.label_date && ` · published ${selected.label_date}`}
                      </span>
                    </span>
                  )
                })()}
                <button
                  type="button"
                  onClick={() => setPhase('scan-label')}
                  className="flex items-center gap-1.5 text-xs text-tx-muted hover:text-tx-primary transition-colors flex-shrink-0"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {selected.source === 'photo' ? 'Rescan label' : 'Scan label'}
                </button>
              </div>

              {/* Calorie hero */}
              <div className="flex items-end justify-between mb-5">
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <input
                      type="number"
                      aria-label="Calories"
                      value={cal}
                      onChange={e => setMacro('calories', Number(e.target.value) || 0)}
                      className="text-5xl font-bold tabular-nums text-tx-primary leading-none bg-transparent border-0 outline-none w-32"
                    />
                    <span className="text-sm text-tx-muted">kcal</span>
                  </div>
                  {/* The amount picker owns the portion, so state it as chosen
                      rather than as a raw multiplier ("per 0.138 × per 100g"),
                      which exposes bookkeeping the user never typed. Naming the
                      serving itself lives in the Amount card's serving editor. */}
                  <p className="text-xs text-tx-muted mt-1">for {formatServingLabel(amount, unit)}</p>
                </div>
                {/* Macro composition mini-bars */}
                {(pro + carb + fat_) > 0 && (
                  <div className="flex flex-col gap-1 items-end w-20 flex-shrink-0">
                    {[
                      { label: 'P', value: pro, color: MACRO_COLORS.protein },
                      { label: 'C', value: carb, color: MACRO_COLORS.carbs },
                      { label: 'F', value: fat_, color: MACRO_COLORS.fat },
                    ].map(m => {
                      const total = pro + carb + fat_
                      const pct = total > 0 ? Math.round((m.value / total) * 100) : 0
                      return (
                        <div key={m.label} className="flex items-center gap-1.5 w-full">
                          <span className="text-[10px] text-tx-muted w-3 text-right flex-shrink-0">{m.label}</span>
                          <div className="flex-1 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: m.color }} />
                          </div>
                          <span className="text-[10px] tabular-nums w-6 text-right flex-shrink-0" style={{ color: m.color }}>{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Macro grid */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { field: 'protein' as const, label: 'Protein', value: pro, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
                  { field: 'carbs' as const,   label: 'Carbs',   value: carb, color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' },
                  { field: 'fat' as const,     label: 'Fat',     value: fat_, color: 'text-violet-400',  bg: 'bg-violet-500/10 border-violet-500/20' },
                  { field: 'fiber' as const,   label: 'Fiber',   value: fib,  color: 'text-tx-secondary', bg: 'bg-surface-muted border-surface-border' },
                  { field: 'sugar' as const,   label: 'Sugar',   value: sug,  color: 'text-tx-secondary', bg: 'bg-surface-muted border-surface-border' },
                  { field: 'sodium' as const,  label: 'Sodium (mg)', value: sod, color: 'text-tx-secondary', bg: 'bg-surface-muted border-surface-border' },
                  { field: 'cholesterol' as const, label: 'Cholesterol (mg)', value: chol, color: 'text-tx-secondary', bg: 'bg-surface-muted border-surface-border' },
                ].map(m => (
                  <div key={m.label} className={`rounded-xl border p-2.5 text-center ${m.bg}`}>
                    <div className="flex items-baseline justify-center gap-0.5">
                      <input
                        type="number"
                        aria-label={m.label}
                        value={m.value}
                        onChange={e => setMacro(m.field, Number(e.target.value) || 0)}
                        className={`text-sm font-bold tabular-nums bg-transparent border-0 outline-none w-10 text-center ${m.color}`}
                      />
                      {m.field !== 'sodium' && m.field !== 'cholesterol' && <span className={`text-sm font-bold ${m.color}`}>g</span>}
                    </div>
                    <p className="text-[10px] text-tx-muted mt-0.5">{m.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Amount */}
          <div className="card p-4 space-y-3">
            <label className="label">Amount</label>
            <PortionPicker
              options={unitOptions}
              amount={amount}
              unitId={unitId}
              onChange={setPortion}
              size="lg"
            />
            <ServingEditor
              servingSize={selected.serving_size ?? ''}
              servingSizeGrams={selected.serving_size_grams ?? 0}
              onChange={setServing}
              size="lg"
            />
          </div>

          {/* Log to: meal + when */}
          <div className="card p-4 space-y-5">
            {/* Meal */}
            <div className="space-y-3">
              <label className="label">Meal</label>
              <div className="grid grid-cols-2 gap-2">
                {MEALS.map(m => {
                  const MealIcon = MEAL_ICONS[m]
                  const iconColor = MEAL_COLORS[m]
                  const active = meal === m
                  return (
                    <button
                      key={m}
                      onClick={() => setMeal(m)}
                      className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border font-medium text-sm transition-all ${
                        active
                          ? 'bg-brand-500/10 border-brand-500/40 text-tx-primary'
                          : 'bg-surface-muted border-surface-border text-tx-secondary hover:text-tx-primary hover:bg-surface-overlay'
                      }`}
                    >
                      <MealIcon className={`w-4 h-4 flex-shrink-0 ${active ? iconColor : 'text-tx-muted'}`} />
                      {MEAL_LABELS[m]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="border-t border-surface-border" />

            <DateInput label="When" value={date} onChange={setDate} max={todayStr()} />
          </div>

          {/* Save to My Foods toggle — hidden in edit mode */}
          {!editId && <button
            type="button"
            onClick={() => setSaveToMyFoods(v => !v)}
            className="flex items-center gap-3 w-full card p-4 hover:bg-surface-muted/50 transition-colors"
          >
            <div className={`relative w-11 h-6 rounded-full border transition-colors flex-shrink-0 ${saveToMyFoods ? 'bg-brand-500 border-brand-500' : 'bg-surface-muted border-surface-border'}`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${saveToMyFoods ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <div className="flex items-center gap-2 flex-1">
              {saveToMyFoods
                ? <BookmarkCheck className="w-4 h-4 text-brand-500" />
                : <Bookmark className="w-4 h-4 text-tx-muted" />
              }
              <span className="text-sm font-medium text-tx-secondary">Save to My Foods</span>
            </div>
          </button>}
        </div>
      )}

      {/* Detail phase — condensed quick-log (My Foods / Recent). Read-only
          nutrition, quick meal + quantity, collapsed date; fits above the sticky
          Log button without scrolling. */}
      {phase === 'detail' && selected && condensed && (
        <div className="space-y-3 pb-28">
          {saveError && (
            <div className="alert-error">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Nutrition summary (read-only) + servings, in one card */}
          <div className="card p-4 space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tabular-nums text-tx-primary leading-none">{cal}</span>
                  <span className="text-sm text-tx-muted">kcal</span>
                  {(carb + fat_) > 0 && (
                    <span className="text-xs text-tx-muted tabular-nums ml-1">
                      <span className="text-amber-400">{carb}c</span> · <span className="text-violet-400">{fat_}f</span>
                    </span>
                  )}
                </div>
                {selected.serving_size && (
                  <p className="text-xs text-tx-muted mt-1 truncate">
                    {unitOptions.length > 1
                      ? formatServingLabel(amount, unit)
                      : `${servings === 1 ? '' : `${servings} × `}${selected.serving_size}`}
                  </p>
                )}
              </div>
              <div className="flex items-baseline gap-1 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 flex-shrink-0">
                <span className="text-2xl font-bold tabular-nums text-emerald-400 leading-none">{pro}</span>
                <span className="text-sm font-bold text-emerald-400">g</span>
                <span className="text-[10px] text-tx-muted ml-0.5">protein</span>
              </div>
            </div>

            <PortionPicker
              options={unitOptions}
              amount={amount}
              unitId={unitId}
              onChange={setPortion}
              size="md"
            />
            <ServingEditor
              servingSize={selected.serving_size ?? ''}
              servingSizeGrams={selected.serving_size_grams ?? 0}
              onChange={setServing}
              size="md"
            />
          </div>

          {/* Meal + collapsed date */}
          <div className="card p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {MEALS.map(m => {
                const MealIcon = MEAL_ICONS[m]
                const iconColor = MEAL_COLORS[m]
                const active = meal === m
                return (
                  <button
                    key={m}
                    onClick={() => setMeal(m)}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border font-medium text-sm transition-all ${
                      active
                        ? 'bg-brand-500/10 border-brand-500/40 text-tx-primary'
                        : 'bg-surface-muted border-surface-border text-tx-secondary hover:text-tx-primary hover:bg-surface-overlay'
                    }`}
                  >
                    <MealIcon className={`w-4 h-4 flex-shrink-0 ${active ? iconColor : 'text-tx-muted'}`} />
                    {MEAL_LABELS[m]}
                  </button>
                )
              })}
            </div>

            {showDate ? (
              <DateInput label="When" value={date} onChange={setDate} max={todayStr()} />
            ) : (
              <button
                type="button"
                onClick={() => setShowDate(true)}
                className="flex items-center justify-between w-full text-sm pt-1"
              >
                <span className="label">When</span>
                <span className="flex items-center gap-1.5 text-tx-secondary">
                  {date === todayStr() ? 'Today' : date}
                  <Pencil className="w-3.5 h-3.5 text-tx-muted" />
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Smart entry review phase */}
      {phase === 'smart-review' && (
        <div className="space-y-4 pb-32">
          {mealLogError && (
            <div className="alert-error">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{mealLogError}</span>
            </div>
          )}

          {/* Log to: meal + when (shared across all parsed items) */}
          <div className="card p-4 space-y-5">
            <div className="space-y-3">
              <label className="label">Meal</label>
              <div className="grid grid-cols-2 gap-2">
                {MEALS.map(m => {
                  const MealIcon = MEAL_ICONS[m]
                  const iconColor = MEAL_COLORS[m]
                  const active = meal === m
                  return (
                    <button
                      key={m}
                      onClick={() => setMeal(m)}
                      className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border font-medium text-sm transition-all ${
                        active
                          ? 'bg-brand-500/10 border-brand-500/40 text-tx-primary'
                          : 'bg-surface-muted border-surface-border text-tx-secondary hover:text-tx-primary hover:bg-surface-overlay'
                      }`}
                    >
                      <MealIcon className={`w-4 h-4 flex-shrink-0 ${active ? iconColor : 'text-tx-muted'}`} />
                      {MEAL_LABELS[m]}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="border-t border-surface-border" />
            <DateInput label="When" value={date} onChange={setDate} max={todayStr()} />
          </div>

          {/* Parsed items */}
          {mealItems.map((item, i) => (
            <MealItemEditCard
              key={i}
              item={item}
              onChange={patch => updateMealItem(i, patch)}
              onRemove={() => removeMealItem(i)}
            />
          ))}

          {mealItems.length === 0 && (
            <div className="px-4 py-14 text-center">
              <Utensils className="w-8 h-8 text-tx-muted opacity-30 mx-auto mb-2" />
              <p className="text-sm text-tx-muted">No items left to log</p>
            </div>
          )}
        </div>
      )}

      {/* Photo-review phase — richer review UI for AnalyzeMealPhoto results:
          photo thumbnail, overall assessment, and per-item confidence/reasoning. */}
      {phase === 'photo-review' && photoAnalysis && (
        <div className="space-y-4 pb-32">
          {photoLogError && (
            <div className="alert-error">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{photoLogError}</span>
            </div>
          )}

          <AuthedImg
            src={photoAnalysis.image_url}
            alt="Analyzed meal"
            className="w-full max-h-56 object-cover rounded-xl"
            fallback={<div className="w-full h-40 rounded-xl bg-surface-muted animate-pulse" />}
          />

          {photoAnalysis.assessment && (
            <div className="flex items-start gap-2 rounded-xl border border-brand-500/20 bg-brand-500/10 px-3.5 py-3 text-xs text-tx-secondary">
              <Sparkles className="w-4 h-4 flex-shrink-0 text-brand-500 mt-0.5" />
              <span>{photoAnalysis.assessment}</span>
            </div>
          )}

          {/* Log to: meal + when (shared across all identified items) */}
          <div className="card p-4 space-y-5">
            <div className="space-y-3">
              <label className="label">Meal</label>
              <div className="grid grid-cols-2 gap-2">
                {MEALS.map(m => {
                  const MealIcon = MEAL_ICONS[m]
                  const iconColor = MEAL_COLORS[m]
                  const active = meal === m
                  return (
                    <button
                      key={m}
                      onClick={() => setMeal(m)}
                      className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border font-medium text-sm transition-all ${
                        active
                          ? 'bg-brand-500/10 border-brand-500/40 text-tx-primary'
                          : 'bg-surface-muted border-surface-border text-tx-secondary hover:text-tx-primary hover:bg-surface-overlay'
                      }`}
                    >
                      <MealIcon className={`w-4 h-4 flex-shrink-0 ${active ? iconColor : 'text-tx-muted'}`} />
                      {MEAL_LABELS[m]}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="border-t border-surface-border" />
            <DateInput label="When" value={date} onChange={setDate} max={todayStr()} />
          </div>

          {photoReviewItems.map((item, i) => (
            <MealItemEditCard
              key={i}
              item={item}
              confidence={item.confidence}
              portionReasoning={item.portion_reasoning}
              onChange={patch => updatePhotoItem(i, patch)}
              onRemove={() => removePhotoItem(i)}
            />
          ))}

          {photoReviewItems.length === 0 && (
            <div className="px-4 py-14 text-center">
              <Utensils className="w-8 h-8 text-tx-muted opacity-30 mx-auto mb-2" />
              <p className="text-sm text-tx-muted">No items left to log</p>
            </div>
          )}
        </div>
      )}

      {/* Sticky log button — detail phase only */}
      {phase === 'detail' && selected && (
        <div className="fixed bottom-0 inset-x-0 z-[60] p-4 bg-surface-base/95 backdrop-blur-sm border-t border-surface-border safe-area-bottom">
          <button
            onClick={handleLog}
            disabled={saving}
            className="btn-primary btn-lg w-full"
          >
            {saving ? 'Saving…' : editId ? 'Save Changes' : 'Log Food'}
          </button>
        </div>
      )}

      {/* Sticky log button — smart-review phase only */}
      {phase === 'smart-review' && (
        <div className="fixed bottom-0 inset-x-0 z-[60] p-4 bg-surface-base/95 backdrop-blur-sm border-t border-surface-border safe-area-bottom">
          <button
            onClick={handleLogMealItems}
            disabled={loggingMealItems || mealItems.filter(item => item.include).length === 0}
            className="btn-primary btn-lg w-full"
          >
            {loggingMealItems ? 'Saving…' : `Log ${mealItems.filter(item => item.include).length} item${mealItems.filter(item => item.include).length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {/* Sticky log button — photo-review phase only */}
      {phase === 'photo-review' && (
        <div className="fixed bottom-0 inset-x-0 z-[60] p-4 bg-surface-base/95 backdrop-blur-sm border-t border-surface-border safe-area-bottom">
          <button
            onClick={handleLogPhotoItems}
            disabled={loggingPhotoItems || photoReviewItems.filter(item => item.include).length === 0}
            className="btn-primary btn-lg w-full"
          >
            {loggingPhotoItems ? 'Saving…' : `Log ${photoReviewItems.filter(item => item.include).length} item${photoReviewItems.filter(item => item.include).length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {/* Edit saved food sheet */}
      {editingSavedFood && (
        <EditSavedFoodSheet
          food={editingSavedFood}
          open={editingSavedFood !== null}
          onClose={() => setEditingSavedFood(null)}
          onSaved={updated => {
            setSavedFoods(prev => prev.map(sf => sf.id === updated.id ? updated : sf))
            setEditingSavedFood(updated)
          }}
          onDeleted={id => {
            setSavedFoods(prev => prev.filter(sf => sf.id !== id))
            setEditingSavedFood(null)
          }}
        />
      )}
    </div>
  )
}
