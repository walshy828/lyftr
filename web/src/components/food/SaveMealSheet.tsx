import { useEffect, useState } from 'react'
import { BookmarkPlus } from 'lucide-react'
import Sheet from '../ui/Sheet'
import FoodAvatar from '../ui/FoodAvatar'
import { mealTemplatesAPI, apiErrorMessage } from '../../services/api'
import * as types from '../../types'

interface Props {
  entries: types.FoodLog[] | null
  defaultName: string
  onClose: () => void
  onSaved: (t: types.MealTemplate) => void
}

/** Name and save a diary meal as a reusable meal (template). */
export default function SaveMealSheet({ entries, defaultName, onClose, onSaved }: Props) {
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (entries) { setName(defaultName); setError(null) } }, [entries, defaultName])

  const save = async () => {
    if (!entries || !name.trim()) return
    setSaving(true)
    try {
      onSaved(await mealTemplatesAPI.create(name.trim(), entries.map(e => e.id)))
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save that meal'))
    } finally {
      setSaving(false)
    }
  }

  const kcal = (entries ?? []).reduce((s, e) => s + e.calories, 0)

  return (
    <Sheet isOpen={!!entries} onClose={onClose} title="Save as a meal" icon={<BookmarkPlus className="w-4 h-4 text-brand-400" />}>
      <form className="p-5 space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
        <div className="flex items-center gap-2 flex-wrap">
          {(entries ?? []).map(e => (
            <span key={e.id} className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-surface-overlay text-xs text-tx-secondary">
              <FoodAvatar food={e} size="xs" /> {e.name}
            </span>
          ))}
        </div>
        <p className="text-xs text-tx-muted tabular-nums">{entries?.length ?? 0} item{entries?.length === 1 ? '' : 's'} · {Math.round(kcal)} kcal</p>
        <div className="input-group">
          <label className="label" htmlFor="meal-name">Name</label>
          <input id="meal-name" className="input" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus />
        </div>
        {error && <p className="text-xs text-error-400">{error}</p>}
        <button type="submit" disabled={saving || !name.trim()} className="btn-primary btn-lg w-full">
          {saving ? 'Saving…' : 'Save meal'}
        </button>
      </form>
    </Sheet>
  )
}
