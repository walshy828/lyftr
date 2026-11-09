import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import {
  Sparkles, Camera, Search, ScanBarcode, ScanText, Scale, Dumbbell, Footprints,
  HeartPulse, Check, Undo2, ListChecks, Plus,
} from 'lucide-react'
import Sheet from '../ui/Sheet'
import FoodAvatar from '../ui/FoodAvatar'
import QuickWeighInSheet from '../QuickWeighInSheet'
import QuickCardioModal from '../QuickCardioModal'
import BPEntrySheet from '../BPEntrySheet'
import CopyMealModal from '../CopyMealModal'
import { foodAPI, weightAPI } from '../../services/api'
import { useSettingsStore, displayWeight } from '../../stores/settings'
import { useWorkoutSession } from '../../stores/workoutSession'
import { todayStr } from '../../utils/dateUtils'
import { mealForNow } from '../../utils/foodVisual'
import * as types from '../../types'

type Meal = types.FoodLog['meal']
const MEAL_LABEL: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' }
const MEAL_ORDER: Meal[] = ['breakfast', 'lunch', 'dinner', 'snacks']

/** Tell any mounted food view that the day's entries changed underneath it. */
export const FOOD_CHANGED_EVENT = 'lyftr:food-changed'
const announceFoodChanged = () => window.dispatchEvent(new Event(FOOD_CHANGED_EVENT))

interface PastMeal {
  key: string
  date: string
  dayLabel: string
  meal: Meal
  entries: types.FoodLog[]
  kcal: number
}

interface Toast { text: string; undoIds: number[] }

/**
 * The one place every daily input starts from — the centre "+" in the nav.
 *
 * Ordered by how often each thing is actually done: describe/snap a meal with
 * AI first, then re-log what you usually eat (whole recent meals, then single
 * favourites, each one tap), then the long tail (search, barcode, label), then
 * the non-food logs (weight, workout, cardio, BP).
 */
export default function QuickLogSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { settings } = useSettingsStore()
  const { session } = useWorkoutSession()
  const [meal, setMeal] = useState<Meal>(mealForNow())
  const [recent, setRecent] = useState<types.RecentFood[]>([])
  const [pastMeals, setPastMeals] = useState<PastMeal[]>([])
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [doneKeys, setDoneKeys] = useState<string[]>([])
  const [toast, setToast] = useState<Toast | null>(null)
  const [sub, setSub] = useState<null | 'weight' | 'cardio' | 'bp' | { copyMeal: Meal }>(null)
  const [lastWeight, setLastWeight] = useState<types.WeightLog | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setMeal(mealForNow())
    setDoneKeys([])
    setToast(null)
    foodAPI.recent().then(r => setRecent(r ?? [])).catch(() => setRecent([]))
    const now = new Date()
    const days = [1, 2, 3].map(n => subDays(now, n))
    Promise.all(days.map(d => foodAPI.list(format(d, 'yyyy-MM-dd')).catch(() => [] as types.FoodLog[])))
      .then(lists => {
        const out: PastMeal[] = []
        lists.forEach((logs, i) => {
          const date = format(days[i], 'yyyy-MM-dd')
          const dayLabel = i === 0 ? 'Yesterday' : format(days[i], 'EEEE')
          for (const m of MEAL_ORDER) {
            const entries = (logs ?? []).filter(l => l.meal === m)
            if (entries.length) out.push({
              key: `${date}-${m}`, date, dayLabel, meal: m, entries,
              kcal: entries.reduce((s, e) => s + e.calories, 0),
            })
          }
        })
        // The meal you're about to eat first (yesterday's breakfast at 8am),
        // then everything else most-recent first.
        out.sort((a, b) => Number(b.meal === mealForNow()) - Number(a.meal === mealForNow()))
        setPastMeals(out.slice(0, 8))
      })
  }, [isOpen])

  const favorites = useMemo(
    () => [...recent].sort((a, b) => b.log_count - a.log_count).slice(0, 12),
    [recent],
  )

  const copy = async (key: string, ids: number[], text: string, targetMeal?: Meal) => {
    setBusyKey(key)
    try {
      const created = await foodAPI.copy(ids, todayStr(), targetMeal)
      setDoneKeys(k => [...k, key])
      setToast({ text, undoIds: created.map(c => c.id) })
      announceFoodChanged()
    } catch {
      setToast({ text: 'Could not log that — try again', undoIds: [] })
    } finally {
      setBusyKey(null)
    }
  }

  const undo = async () => {
    if (!toast) return
    await Promise.all(toast.undoIds.map(id => foodAPI.delete(id).catch(() => {})))
    setToast(null)
    setDoneKeys([])
    announceFoodChanged()
  }

  const go = (path: string) => { onClose(); navigate(path) }
  const foodPath = (mode?: string) =>
    `/food/log?meal=${meal}&date=${todayStr()}${mode ? `&mode=${mode}` : ''}`

  const openWeight = () => {
    weightAPI.list({ limit: 1 }).then(l => setLastWeight(l?.[0] ?? null)).catch(() => setLastWeight(null))
    setSub('weight')
  }

  return (
    <>
      <Sheet isOpen={isOpen && sub === null} onClose={onClose} title="Log">
        <div className="px-4 pb-6 pt-3 space-y-5">
          {/* Meal target — everything food-related below lands here */}
          <div className="flex gap-1.5 p-1 rounded-xl bg-surface-overlay" role="radiogroup" aria-label="Meal">
            {MEAL_ORDER.map(m => (
              <button
                key={m}
                role="radio"
                aria-checked={meal === m}
                onClick={() => setMeal(m)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  meal === m ? 'bg-surface-raised text-tx-primary shadow-sm' : 'text-tx-muted'
                }`}
              >
                {MEAL_LABEL[m]}
              </button>
            ))}
          </div>

          {/* AI first: the most common way a meal gets in */}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              onClick={() => go(foodPath('describe'))}
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left border border-brand-500/30 bg-brand-500/10 hover:bg-brand-500/15 transition-colors"
            >
              <Sparkles className="w-5 h-5 text-brand-400 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-tx-primary">Describe your {MEAL_LABEL[meal].toLowerCase()}</span>
                <span className="block text-xs text-tx-muted truncate">“2 eggs, toast with butter, black coffee”</span>
              </span>
            </button>
            <button
              onClick={() => go(foodPath('photo'))}
              aria-label="Snap a meal photo"
              className="w-16 rounded-2xl flex flex-col items-center justify-center gap-1 border border-surface-border bg-surface-raised hover:border-tx-faint transition-colors"
            >
              <Camera className="w-5 h-5 text-tx-primary" />
              <span className="text-[10px] font-semibold text-tx-muted">Photo</span>
            </button>
          </div>

          {toast && (
            <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-surface-raised border border-surface-border shadow-float animate-slide-up" role="status">
              <Check className="w-4 h-4 text-move flex-shrink-0" />
              <span className="flex-1 text-sm text-tx-primary min-w-0 truncate">{toast.text}</span>
              {toast.undoIds.length > 0 && (
                <button onClick={undo} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400">
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </button>
              )}
            </div>
          )}

          {/* Eat it again — whole meals from the last few days */}
          {pastMeals.length > 0 && (
            <section>
              <p className="eyebrow mb-2 px-0.5">Eat it again</p>
              <div className="flex gap-2.5 overflow-x-auto no-scrollbar snap-x-mandatory -mx-4 px-4 pb-1">
                {pastMeals.map(pm => {
                  const done = doneKeys.includes(pm.key)
                  return (
                    <div key={pm.key} className="snap-start flex-shrink-0 w-[220px] card p-3 flex flex-col gap-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-tx-primary truncate">{pm.dayLabel}'s {MEAL_LABEL[pm.meal].toLowerCase()}</p>
                        <span className="text-xs text-tx-muted tabular-nums flex-shrink-0">{Math.round(pm.kcal)} kcal</span>
                      </div>
                      <div className="flex -space-x-2">
                        {pm.entries.slice(0, 5).map(e => (
                          <FoodAvatar key={e.id} food={e} size="sm" className="ring-2 ring-surface-raised" />
                        ))}
                        {pm.entries.length > 5 && (
                          <div className="w-10 h-10 rounded-xl bg-surface-overlay ring-2 ring-surface-raised flex items-center justify-center text-xs font-semibold text-tx-muted">
                            +{pm.entries.length - 5}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-tx-muted line-clamp-2 min-h-[2rem]">{pm.entries.map(e => e.name).join(' · ')}</p>
                      <div className="flex gap-2">
                        <button
                          disabled={busyKey === pm.key || done}
                          onClick={() => copy(pm.key, pm.entries.map(e => e.id), `Added ${pm.entries.length} items to ${MEAL_LABEL[meal]}`, meal)}
                          className={`flex-1 btn-sm ${done ? 'btn-secondary' : 'btn-primary'}`}
                        >
                          {done ? <><Check className="w-3.5 h-3.5" /> Added</> : <><Plus className="w-3.5 h-3.5" /> Add all</>}
                        </button>
                        <button
                          onClick={() => setSub({ copyMeal: pm.meal })}
                          className="btn-secondary btn-sm"
                          aria-label={`Choose items from ${pm.dayLabel}'s ${MEAL_LABEL[pm.meal]}`}
                        >
                          <ListChecks className="w-3.5 h-3.5" /> Pick
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Favourites — single foods, one tap each */}
          {favorites.length > 0 && (
            <section>
              <p className="eyebrow mb-2 px-0.5">Your usuals <span className="normal-case tracking-normal font-normal">· tap to add</span></p>
              <div className="grid grid-cols-4 gap-2">
                {favorites.map(f => {
                  const key = `fav-${f.id}`
                  const done = doneKeys.includes(key)
                  return (
                    <button
                      key={f.id}
                      disabled={busyKey === key}
                      onClick={() => copy(key, [f.id], `${f.name} → ${MEAL_LABEL[meal]}`, meal)}
                      className={`relative flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-colors ${
                        done ? 'border-move/50 bg-move/10' : 'border-transparent hover:bg-surface-overlay'
                      }`}
                    >
                      <FoodAvatar food={f} size="md" />
                      {done && (
                        <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-move flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </span>
                      )}
                      <span className="text-[11px] leading-tight text-tx-secondary text-center line-clamp-2 w-full">{f.name}</span>
                      <span className="text-[10px] text-tx-muted tabular-nums">{Math.round(f.calories)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Find something new */}
          <section>
            <p className="eyebrow mb-2 px-0.5">Find a food</p>
            <div className="grid grid-cols-3 gap-2">
              <Tile icon={Search} label="Search" onClick={() => go(foodPath())} />
              <Tile icon={ScanBarcode} label="Barcode" onClick={() => go(foodPath('scan'))} />
              <Tile icon={ScanText} label="Label" onClick={() => go(foodPath('label'))} />
            </div>
          </section>

          {/* Everything that isn't food */}
          <section>
            <p className="eyebrow mb-2 px-0.5">Body & training</p>
            <div className="grid grid-cols-4 gap-2">
              <Tile icon={Scale} label="Weight" tone="text-body" onClick={openWeight} />
              <Tile icon={Dumbbell} label={session ? 'Resume' : 'Workout'} tone="text-train" onClick={() => go(session ? '/workout/active' : '/workout/start')} />
              <Tile icon={Footprints} label="Cardio" tone="text-move" onClick={() => setSub('cardio')} />
              <Tile icon={HeartPulse} label="BP" tone="text-heart" onClick={() => setSub('bp')} />
            </div>
          </section>
        </div>
      </Sheet>

      <QuickWeighInSheet
        isOpen={isOpen && sub === 'weight'}
        lastValue={lastWeight ? displayWeight(lastWeight.raw_weight ?? lastWeight.weight, settings.weight_unit) : null}
        lastLog={lastWeight}
        onClose={() => setSub(null)}
        onSuccess={() => { setSub(null); onClose() }}
      />
      {isOpen && sub === 'cardio' && (
        <QuickCardioModal onClose={() => setSub(null)} onLogged={() => { setSub(null); onClose() }} />
      )}
      <BPEntrySheet
        isOpen={isOpen && sub === 'bp'}
        onClose={() => setSub(null)}
        onSuccess={() => { setSub(null); onClose() }}
      />
      {isOpen && sub && typeof sub === 'object' && (
        <CopyMealModal
          targetDate={todayStr()}
          meal={sub.copyMeal}
          onClose={() => setSub(null)}
          onCopied={() => { announceFoodChanged(); setSub(null); onClose() }}
        />
      )}
    </>
  )
}

function Tile({ icon: Icon, label, onClick, tone = 'text-tx-primary' }: {
  icon: React.ElementType; label: string; onClick: () => void; tone?: string
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-2xl bg-surface-raised border border-surface-border hover:border-tx-faint active:scale-[0.97] transition-all"
    >
      <Icon className={`w-5 h-5 ${tone}`} />
      <span className="text-xs font-medium text-tx-secondary">{label}</span>
    </button>
  )
}
