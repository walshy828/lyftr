import { useEffect, useState } from 'react'
import { Plus, Trash2, Scale, AlertCircle } from 'lucide-react'
import { clothingAPI, apiErrorMessage } from '../services/api'
import { useSettingsStore, weightShort, lbsToDisplay, displayToLbs, round1 } from '../stores/settings'
import { useClothingProfiles } from '../hooks/useClothingProfiles'
import * as types from '../types'

// Offsets are entered in the user's display unit and stored in lbs.
function ProfileRow({ profile, onChanged, onError }: {
  profile: types.ClothingProfile
  onChanged: () => void
  onError: (msg: string) => void
}) {
  const { settings } = useSettingsStore()
  const unit = settings.weight_unit
  const [name, setName] = useState(profile.name)
  const [offset, setOffset] = useState(String(round1(lbsToDisplay(profile.offset_lbs, unit))))
  const [calibrating, setCalibrating] = useState(false)
  const [clothed, setClothed] = useState('')
  const [bare, setBare] = useState('')

  useEffect(() => {
    setName(profile.name)
    setOffset(String(round1(lbsToDisplay(profile.offset_lbs, unit))))
  }, [profile, unit])

  const save = async (nextName: string, nextOffset: string) => {
    const off = parseFloat(nextOffset)
    if (!nextName.trim() || !Number.isFinite(off) || off < 0) return
    if (nextName.trim() === profile.name && round1(off) === round1(lbsToDisplay(profile.offset_lbs, unit))) return
    try {
      await clothingAPI.update(profile.id, { name: nextName.trim(), offset_lbs: displayToLbs(off, unit) })
      onChanged()
    } catch (err) {
      onError(apiErrorMessage(err, 'Could not save clothing profile.'))
    }
  }

  const applyCalibration = () => {
    const diff = round1(parseFloat(clothed) - parseFloat(bare))
    if (!Number.isFinite(diff) || diff < 0) return
    setOffset(String(diff))
    setCalibrating(false)
    setClothed('')
    setBare('')
    save(name, String(diff))
  }

  const remove = async () => {
    try {
      await clothingAPI.delete(profile.id)
      onChanged()
    } catch (err) {
      onError(apiErrorMessage(err, 'Could not delete clothing profile.'))
    }
  }

  return (
    <div className="py-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          maxLength={40}
          onChange={e => setName(e.target.value)}
          onBlur={() => save(name, offset)}
          className="input flex-1 min-w-0"
          aria-label="Profile name"
        />
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min={0}
          value={offset}
          disabled={profile.is_default}
          onChange={e => setOffset(e.target.value)}
          onBlur={() => save(name, offset)}
          className="input w-20 text-right"
          aria-label={`${profile.name} offset`}
        />
        <span className="text-xs text-tx-muted w-5">{weightShort(unit)}</span>
        {profile.is_default ? (
          <span className="w-8" />
        ) : (
          <button onClick={remove} className="p-1.5 hover:bg-error-500/10 rounded-lg" aria-label={`Delete ${profile.name}`}>
            <Trash2 className="w-4 h-4 text-error-400" />
          </button>
        )}
      </div>
      {profile.is_default ? (
        <p className="text-[11px] text-tx-muted">Baseline (no adjustment). Used for existing entries and new ones by default.</p>
      ) : calibrating ? (
        <div className="flex items-center gap-2 flex-wrap text-xs text-tx-secondary">
          <input type="number" inputMode="decimal" step="0.1" placeholder="In these clothes" value={clothed}
            onChange={e => setClothed(e.target.value)} className="input w-32" aria-label="Weight in these clothes" />
          <span>−</span>
          <input type="number" inputMode="decimal" step="0.1" placeholder="Without" value={bare}
            onChange={e => setBare(e.target.value)} className="input w-24" aria-label="Weight without clothes" />
          <button type="button" onClick={applyCalibration} className="btn-primary btn-sm">Set</button>
          <button type="button" onClick={() => setCalibrating(false)} className="text-tx-muted hover:text-tx-primary">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setCalibrating(true)}
          className="text-[11px] text-brand-400 hover:text-brand-300 flex items-center gap-1">
          <Scale className="w-3 h-3" /> Calibrate from two weigh-ins
        </button>
      )}
    </div>
  )
}

export default function ClothingProfilesEditor() {
  const { settings } = useSettingsStore()
  const unit = settings.weight_unit
  const { profiles, reload } = useClothingProfiles()
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newOffset, setNewOffset] = useState('')

  const add = async () => {
    const off = parseFloat(newOffset)
    if (!newName.trim() || !Number.isFinite(off) || off < 0) return
    try {
      await clothingAPI.create({ name: newName.trim(), offset_lbs: displayToLbs(off, unit) })
      setNewName('')
      setNewOffset('')
      setError('')
      reload()
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not add clothing profile.'))
    }
  }

  return (
    <div className="py-4">
      <p className="text-sm font-medium text-tx-primary">Weigh-in clothing</p>
      <p className="text-xs text-tx-muted mt-0.5">
        Layers add weight to the scale. Pick what you wore when you log, and the offset is subtracted so
        your trend isn't thrown off by the season. Changing an offset re-adjusts every entry that used it.
      </p>
      {error && (
        <div className="alert-error mt-3" role="alert">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /><span>{error}</span>
        </div>
      )}
      <div className="divide-y divide-surface-border mt-2">
        {profiles.map(p => (
          <ProfileRow key={p.id} profile={p} onChanged={() => { setError(''); reload() }} onError={setError} />
        ))}
      </div>
      <div className="flex items-center gap-2 pt-3">
        <input type="text" value={newName} maxLength={40} placeholder="New outfit, e.g. Heavy coat"
          onChange={e => setNewName(e.target.value)} className="input flex-1 min-w-0" aria-label="New profile name" />
        <input type="number" inputMode="decimal" step="0.1" min={0} value={newOffset} placeholder="0"
          onChange={e => setNewOffset(e.target.value)} className="input w-20 text-right" aria-label="New profile offset" />
        <span className="text-xs text-tx-muted w-5">{weightShort(unit)}</span>
        <button onClick={add} disabled={!newName.trim() || !(parseFloat(newOffset) >= 0)}
          className="p-1.5 hover:bg-surface-muted rounded-lg disabled:opacity-40" aria-label="Add clothing profile">
          <Plus className="w-4 h-4 text-brand-500" />
        </button>
      </div>
    </div>
  )
}
