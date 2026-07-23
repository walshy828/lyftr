import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useServerStore } from '../stores/server'
import { useServerInfo } from '../hooks/useServerInfo'
import { useSettingsStore } from '../stores/settings'
import { useTheme } from '../hooks/useTheme'
import { exerciseAPI, profileAPI } from '../services/api'
import * as types from '../types'
import { HelpTip } from '../components/Tooltip'
import PageHeader from '../components/ui/PageHeader'
import DateInput from '../components/ui/DateInput'
import ServerSettings from '../components/ServerSettings'
import { todayStr } from '../utils/dateUtils'
import {
  User, Shield, Target, Moon, Sun, Server, LogOut, Trash2, ChevronRight, Check, AlertCircle, Loader,
  Dumbbell, RefreshCw, Pencil, Clock, Minus, Plus, KeyRound, HeartPulse,
} from 'lucide-react'

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex-1 mr-4">
        <p className="text-sm font-medium text-tx-primary">{label}</p>
        {description && <p className="text-xs text-tx-muted mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 bg-surface-muted border-b border-surface-border">
        <p className="text-xs font-semibold text-tx-muted uppercase tracking-wider">{title}</p>
      </div>
      <div className="px-5 divide-y divide-surface-border">
        {children}
      </div>
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const serverUrl = useServerStore(s => s.serverUrl)
  const serverInfo = useServerInfo()
  const { theme, toggleTheme } = useTheme()
  const { settings: storedSettings, update: updateSettings, fetch: fetchSettings, setWorkoutLayout, setRestEnabled, setRestSeconds } = useSettingsStore()
  const [loading, setLoading] = useState(!useSettingsStore.getState().loaded)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showCustomRest, setShowCustomRest] = useState(false)

  const [seedStatus, setSeedStatus] = useState<{ count: number; in_progress: boolean } | null>(null)
  const [seedAction, setSeedAction] = useState<'sync' | null>(null)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  const [profile, setProfile] = useState<types.ProfileWithBMI | null>(null)
  const [profileForm, setProfileForm] = useState<types.UserProfile>({
    user_id: 0, birth_date: '', sex: '', height_inches: 0, activity_level: 'moderate',
  })
  // Height entered as feet + inches for readability; height_inches on
  // profileForm stays the canonical total the API expects.
  const [heightFeet, setHeightFeet] = useState('')
  const [heightInchesPart, setHeightInchesPart] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const loadProfile = useCallback(async () => {
    try {
      const p = await profileAPI.get()
      setProfile(p)
      setProfileForm({ user_id: p.user_id, birth_date: p.birth_date, sex: p.sex, height_inches: p.height_inches, activity_level: p.activity_level })
      if (p.height_inches > 0) {
        setHeightFeet(String(Math.floor(p.height_inches / 12)))
        setHeightInchesPart(String(Math.round(p.height_inches % 12)))
      }
    } catch {}
  }, [])

  const setHeight = (feet: string, inches: string) => {
    setHeightFeet(feet)
    setHeightInchesPart(inches)
    const totalInches = (parseInt(feet) || 0) * 12 + (parseInt(inches) || 0)
    setProfileForm(prev => ({ ...prev, height_inches: totalInches }))
  }

  const handleSaveProfile = async () => {
    setProfileSaving(true)
    setProfileError(null)
    try {
      // Partial update: the backend treats an omitted key as "leave
      // unchanged" (COALESCE over the existing row), but a present key with
      // an empty/zero value fails validation (e.g. sex must be 'male' or
      // 'female', never ''). Only send fields the user has actually set,
      // otherwise an untouched field silently rejects the whole save.
      const patch: Partial<types.UserProfile> = { activity_level: profileForm.activity_level }
      if (profileForm.birth_date) patch.birth_date = profileForm.birth_date
      if (profileForm.sex) patch.sex = profileForm.sex
      if (profileForm.height_inches > 0) patch.height_inches = profileForm.height_inches
      await profileAPI.update(patch)
      await loadProfile()
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch (err: any) {
      setProfileError(err?.response?.data?.error || 'Failed to save profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const [formData, setFormData] = useState({
    weight_unit: storedSettings.weight_unit,
    calorie_target: storedSettings.calorie_target,
    protein_target: storedSettings.protein_target,
    carb_target: storedSettings.carb_target,
    fat_target: storedSettings.fat_target,
    cholesterol_target: storedSettings.cholesterol_target,
    sodium_target: storedSettings.sodium_target,
    food_allergies: storedSettings.food_allergies,
    food_dislikes: storedSettings.food_dislikes,
    food_likes: storedSettings.food_likes,
  })

  const loadSeedStatus = useCallback(async () => {
    try {
      const s = await exerciseAPI.seedStatus()
      setSeedStatus(s)
      return s
    } catch {}
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        await fetchSettings()
        const s = useSettingsStore.getState().settings
        setFormData({
          weight_unit: s.weight_unit,
          calorie_target: s.calorie_target,
          protein_target: s.protein_target,
          carb_target: s.carb_target,
          fat_target: s.fat_target,
          cholesterol_target: s.cholesterol_target,
          sodium_target: s.sodium_target,
          food_allergies: s.food_allergies,
          food_dislikes: s.food_dislikes,
          food_likes: s.food_likes,
        })
      } catch (err: any) {
        setError(err.message || 'Failed to load settings')
      } finally {
        setLoading(false)
      }
    }
    load()
    loadSeedStatus()
    loadProfile()
  }, [loadSeedStatus, loadProfile])

  // Poll while seeding in progress
  useEffect(() => {
    if (!seedStatus?.in_progress) return
    const id = setInterval(async () => {
      const s = await loadSeedStatus()
      if (s && !s.in_progress) clearInterval(id)
    }, 2000)
    return () => clearInterval(id)
  }, [seedStatus?.in_progress, loadSeedStatus])

  const handleSync = async () => {
    setSeedAction('sync')
    setSeedMsg(null)
    try {
      const res = await exerciseAPI.sync()
      setSeedMsg(`Synced ${res.total.toLocaleString()} exercises`)
      loadSeedStatus()
    } catch (err: any) {
      setSeedMsg(err.message || 'Sync failed')
    } finally {
      setSeedAction(null)
    }
  }


  const handleUnitChange = async (unit: 'lbs' | 'kg') => {
    setFormData(prev => ({ ...prev, weight_unit: unit }))
    try {
      await updateSettings({ ...formData, weight_unit: unit })
    } catch {}
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      await updateSettings(formData)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loader className="w-6 h-6 animate-spin text-brand-500" />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-slide-up max-w-2xl">
      <PageHeader title="Settings" subtitle="Preferences and account configuration" />

      {error && (
        <div className="alert-error">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="alert-success">
          <Check className="w-5 h-5 flex-shrink-0" />
          <span>Settings saved successfully</span>
        </div>
      )}

      {/* Account */}
      <Section title="Account">
        <SettingRow label="Email" description="Your login email address">
          <span className="text-sm text-tx-muted font-mono">{user?.email}</span>
        </SettingRow>
        <SettingRow label="Member since">
          <span className="text-sm text-tx-muted">
            {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}
          </span>
        </SettingRow>
        <SettingRow label="Personal access tokens" description="Let external clients, like the MCP server, read and write your data">
          <button onClick={() => navigate('/settings/tokens')} className="btn-secondary btn-sm">
            <KeyRound className="w-3.5 h-3.5" /> Manage
          </button>
        </SettingRow>
      </Section>

      {/* Appearance */}
      <Section title="Appearance">
        <SettingRow label="Theme" description="Interface color scheme">
          <button onClick={toggleTheme} className="btn-secondary btn-sm">
            {theme === 'dark'
              ? <><Moon className="w-3.5 h-3.5" /> Dark</>
              : <><Sun className="w-3.5 h-3.5" /> Light</>
            }
          </button>
        </SettingRow>
      </Section>

      {/* Workout */}
      <Section title="Workout">
        <SettingRow label="Active workout layout" description="How exercises are shown during a workout">
          <div className="flex gap-1 bg-surface-overlay rounded-lg p-1 border border-surface-border">
            {(['list', 'gym'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setWorkoutLayout(mode)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  storedSettings.workout_layout === mode
                    ? 'bg-surface-raised border border-surface-border text-tx-primary shadow-sm'
                    : 'text-tx-muted hover:text-tx-primary'
                }`}
              >
                {mode === 'list' ? 'List' : 'Gym Mode'}
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow label="Rest timer" description="Auto-start a countdown between sets in gym mode">
          <div className="flex gap-1 bg-surface-overlay rounded-lg p-1 border border-surface-border">
            {([['Off', false], ['On', true]] as const).map(([label, val]) => (
              <button
                key={label}
                onClick={() => setRestEnabled(val)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  (storedSettings.rest_enabled ?? true) === val
                    ? 'bg-surface-raised border border-surface-border text-tx-primary shadow-sm'
                    : 'text-tx-muted hover:text-tx-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </SettingRow>

        {(() => {
          const enabled = storedSettings.rest_enabled ?? true
          const presets = [60, 90, 120, 180]
          const cur = storedSettings.rest_seconds_default ?? 90
          const isCustom = !presets.includes(cur)
          const customActive = isCustom || showCustomRest
          const seg = (active: boolean) =>
            `flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
              active ? 'bg-brand-500 text-white' : 'bg-surface-muted text-tx-secondary hover:text-tx-primary'
            }`
          return (
            <div className={`py-4 transition-opacity ${enabled ? '' : 'opacity-40 pointer-events-none select-none'}`} aria-disabled={!enabled}>
              <p className="text-sm font-medium text-tx-primary">Default rest</p>
              <p className="text-xs text-tx-muted mt-0.5 mb-3">Seeds new exercises · per-exercise rest overrides it</p>
              <div className="flex rounded-xl border border-surface-border overflow-hidden divide-x divide-surface-border">
                {presets.map(sec => (
                  <button key={sec} disabled={!enabled} onClick={() => { setShowCustomRest(false); setRestSeconds(sec) }} className={seg(!customActive && cur === sec)}>
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-[11px] font-semibold leading-none">{sec}s</span>
                  </button>
                ))}
                <button disabled={!enabled} onClick={() => setShowCustomRest(true)} className={seg(customActive)}>
                  <Pencil className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-[11px] font-semibold leading-none">{isCustom ? `${cur}s` : 'Custom'}</span>
                </button>
              </div>
              {customActive && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button type="button" disabled={!enabled} aria-label="−5 seconds" onClick={() => setRestSeconds(Math.max(0, cur - 5))}
                    className="p-2.5 rounded-xl bg-surface-muted border border-surface-border text-tx-secondary active:scale-95 hover:text-tx-primary">
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      disabled={!enabled}
                      value={cur}
                      onChange={e => setRestSeconds(Math.max(0, Math.min(3600, Number(e.target.value) || 0)))}
                      className="input w-28 text-center py-2.5 pr-9 text-base font-semibold tabular-nums"
                      aria-label="Custom rest seconds"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-tx-muted pointer-events-none">sec</span>
                  </div>
                  <button type="button" disabled={!enabled} aria-label="+5 seconds" onClick={() => setRestSeconds(Math.min(3600, cur + 5))}
                    className="p-2.5 rounded-xl bg-surface-muted border border-surface-border text-tx-secondary active:scale-95 hover:text-tx-primary">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )
        })()}
      </Section>

      {/* Goals & Units */}
      <Section title="Goals & Units">
        <SettingRow label="Weight unit" description="Changes apply immediately across the app">
          <div className="flex gap-1 bg-surface-overlay rounded-lg p-1 border border-surface-border">
            {(['lbs', 'kg'] as const).map(unit => (
              <button
                key={unit}
                onClick={() => handleUnitChange(unit)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  formData.weight_unit === unit
                    ? 'bg-surface-raised border border-surface-border text-tx-primary shadow-sm'
                    : 'text-tx-muted hover:text-tx-primary'
                }`}
              >
                {unit}
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow label="Calorie target" description="Daily calorie goal">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={formData.calorie_target}
              onChange={e => setFormData({ ...formData, calorie_target: parseInt(e.target.value) || 0 })}
              className="input w-24 text-right"
              min={500}
              max={10000}
            />
            <span className="text-xs text-tx-muted">kcal</span>
          </div>
        </SettingRow>

        <SettingRow label="Protein target" description="Daily protein goal">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={formData.protein_target}
              onChange={e => setFormData({ ...formData, protein_target: parseInt(e.target.value) || 0 })}
              className="input w-24 text-right"
            />
            <span className="text-xs text-tx-muted">g</span>
          </div>
        </SettingRow>

        <SettingRow label="Carb target" description="Daily carb goal">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={formData.carb_target}
              onChange={e => setFormData({ ...formData, carb_target: parseInt(e.target.value) || 0 })}
              className="input w-24 text-right"
            />
            <span className="text-xs text-tx-muted">g</span>
          </div>
        </SettingRow>

        <SettingRow label="Fat target" description="Daily fat goal">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={formData.fat_target}
              onChange={e => setFormData({ ...formData, fat_target: parseInt(e.target.value) || 0 })}
              className="input w-24 text-right"
            />
            <span className="text-xs text-tx-muted">g</span>
          </div>
        </SettingRow>

        <SettingRow label="Cholesterol target" description="Daily cholesterol goal">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={formData.cholesterol_target}
              onChange={e => setFormData({ ...formData, cholesterol_target: parseInt(e.target.value) || 0 })}
              className="input w-24 text-right"
            />
            <span className="text-xs text-tx-muted">mg</span>
          </div>
        </SettingRow>

        <SettingRow label="Sodium target" description="Daily sodium goal">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={formData.sodium_target}
              onChange={e => setFormData({ ...formData, sodium_target: parseInt(e.target.value) || 0 })}
              className="input w-24 text-right"
            />
            <span className="text-xs text-tx-muted">mg</span>
          </div>
        </SettingRow>

        <div className="py-3 flex items-center justify-between">
          <p className="text-xs text-tx-muted">Save calorie and macro targets</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary btn-sm"
          >
            <Check className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save targets'}
          </button>
        </div>
      </Section>

      {/* Profile — demographic facts used for BMI and the AI weight-loss plan */}
      <Section title="Profile">
        {profileError && (
          <div className="py-3">
            <div className="alert-error" role="alert">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{profileError}</span>
            </div>
          </div>
        )}

        <SettingRow label="Birth date" description="Used to calculate age for BMI and plan calculations">
          <div className="w-40">
            <DateInput value={profileForm.birth_date} onChange={v => setProfileForm({ ...profileForm, birth_date: v })} max={todayStr()} />
          </div>
        </SettingRow>

        {profile && profile.age > 0 && (
          <SettingRow label="Age" description="Calculated from your birth date">
            <span className="text-sm text-tx-muted">{profile.age}</span>
          </SettingRow>
        )}

        <SettingRow label="Sex" description="Used for BMR-based plan calculations">
          <div className="flex gap-1 bg-surface-overlay rounded-lg p-1 border border-surface-border">
            {(['male', 'female'] as const).map(sex => (
              <button
                key={sex}
                onClick={() => setProfileForm({ ...profileForm, sex })}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-all ${
                  profileForm.sex === sex
                    ? 'bg-surface-raised border border-surface-border text-tx-primary shadow-sm'
                    : 'text-tx-muted hover:text-tx-primary'
                }`}
              >
                {sex}
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow label="Height" description="Used for BMI and healthy-weight range">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={heightFeet}
              onChange={e => setHeight(e.target.value, heightInchesPart)}
              className="input w-16 px-2 text-center"
              min={0}
              max={9}
              placeholder="ft"
            />
            <span className="text-xs text-tx-muted">ft</span>
            <input
              type="number"
              value={heightInchesPart}
              onChange={e => setHeight(heightFeet, e.target.value)}
              className="input w-16 px-2 text-center"
              min={0}
              max={11}
              placeholder="in"
            />
            <span className="text-xs text-tx-muted">in</span>
          </div>
        </SettingRow>

        <SettingRow label="Activity level" description="Used to estimate calorie needs">
          <select
            value={profileForm.activity_level}
            onChange={e => setProfileForm({ ...profileForm, activity_level: e.target.value as types.UserProfile['activity_level'] })}
            className="input w-full sm:w-52 text-sm"
          >
            <option value="sedentary">Sedentary</option>
            <option value="light">Lightly active</option>
            <option value="moderate">Moderately active</option>
            <option value="active">Active</option>
            <option value="very_active">Very active</option>
          </select>
        </SettingRow>

        {profile && profile.bmi.bmi > 0 && (
          <>
            <SettingRow label="BMI" description={`Healthy range: ${profile.bmi.healthy_range_low.toFixed(0)}-${profile.bmi.healthy_range_high.toFixed(0)} lbs`}>
              <span className="text-sm font-mono text-tx-primary capitalize">{profile.bmi.bmi.toFixed(1)} · {profile.bmi.category}</span>
            </SettingRow>
            <div className="py-3">
              <p className="text-xs text-tx-muted">{profile.bmi.loss_guidance.note}</p>
            </div>
          </>
        )}

        <div className="py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HeartPulse className="w-3.5 h-3.5 text-tx-muted" />
            <p className="text-xs text-tx-muted">{profileSuccess ? 'Profile saved' : 'Used by BMI and the AI weight-loss plan'}</p>
          </div>
          <button onClick={handleSaveProfile} disabled={profileSaving} className="btn-primary btn-sm">
            <Check className="w-3.5 h-3.5" /> {profileSaving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </Section>

      {/* Food preferences — feeds the AI meal recommender */}
      <Section title="Food Preferences">
        <SettingRow label="Allergies" description="Never suggested — foods you must avoid">
          <input
            type="text"
            value={formData.food_allergies}
            onChange={e => setFormData({ ...formData, food_allergies: e.target.value })}
            placeholder="e.g. peanuts, shellfish"
            maxLength={500}
            className="input w-44 sm:w-56"
          />
        </SettingRow>

        <SettingRow label="Dislikes" description="Foods to avoid in meal suggestions">
          <input
            type="text"
            value={formData.food_dislikes}
            onChange={e => setFormData({ ...formData, food_dislikes: e.target.value })}
            placeholder="e.g. mushrooms, cilantro"
            maxLength={500}
            className="input w-44 sm:w-56"
          />
        </SettingRow>

        <SettingRow label="Likes" description="Favorite foods and cuisines to lean toward">
          <input
            type="text"
            value={formData.food_likes}
            onChange={e => setFormData({ ...formData, food_likes: e.target.value })}
            placeholder="e.g. spicy food, salmon"
            maxLength={500}
            className="input w-44 sm:w-56"
          />
        </SettingRow>

        <div className="py-3 flex items-center justify-between">
          <p className="text-xs text-tx-muted">Used by AI meal suggestions on the Nutrition page</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary btn-sm"
          >
            <Check className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </Section>

      {/* Server info */}
      <Section title="Self-Hosted Instance">
        <SettingRow label="API server" description="Backend server this client is connected to">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-success-500 flex-shrink-0" />
            <span className="text-xs font-mono text-tx-muted">{serverUrl || 'This site (reverse proxy)'}</span>
          </div>
        </SettingRow>
        {/* #17: same Server Settings editor as the sign-in screens, so a logged-in
            user can repoint the client (or recover from a bad URL) without signing out. */}
        <div className="py-2">
          <ServerSettings />
        </div>
        <SettingRow label="Database" description="Storage backend">
          <span className="badge-dim">SQLite</span>
        </SettingRow>
        <SettingRow label="Version" description="lyftr backend version">
          <span className="text-xs text-tx-muted font-mono">{serverInfo?.version || '—'}</span>
        </SettingRow>
      </Section>

      {/* Exercise Library */}
      <Section title="Exercise Library">
        <SettingRow
          label="Exercise database"
          description="800+ exercises seeded automatically on first run"
        >
          <div className="flex items-center gap-2">
            {seedStatus?.in_progress ? (
              <span className="flex items-center gap-1.5 text-xs text-brand-400">
                <Loader className="w-3.5 h-3.5 animate-spin" /> Seeding...
              </span>
            ) : (
              <span className="text-sm font-mono text-tx-muted">
                {seedStatus ? seedStatus.count.toLocaleString() : '—'} exercises
              </span>
            )}
          </div>
        </SettingRow>

        {seedMsg && (
          <div className="py-2 px-1">
            <p className="text-xs text-tx-muted">{seedMsg}</p>
          </div>
        )}

        <div className="py-3">
          <button
            onClick={handleSync}
            disabled={!!seedAction || seedStatus?.in_progress}
            className="btn-secondary btn-sm"
          >
            {seedAction === 'sync'
              ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Syncing...</>
              : <><RefreshCw className="w-3.5 h-3.5" /> Re-sync</>
            }
          </button>
        </div>
      </Section>

      {/* Danger Zone */}
      <Section title="Danger Zone">
        <SettingRow label="Sign out" description="Log out of this device">
          <button onClick={() => logout()} className="btn-secondary btn-sm">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </SettingRow>
        <SettingRow label="Delete account" description="Permanently delete all your data">
          <button className="btn-danger btn-sm">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </SettingRow>
      </Section>
    </div>
  )
}
