import { Flame } from 'lucide-react'
import * as types from '../types'
import { weightShort, displayWeight } from '../stores/settings'
import { weeklyLossFromDeficit } from '../utils/nutritionScenarios'

/** The three levels the narrative names. The basis carries all five, but a
 *  plain-language sentence that lists every one of them stops being readable
 *  — the full table (PlanBasis) is where the other two live. */
const NARRATIVE_LEVELS: Array<{ key: types.ActivityEnergyLevel['key']; word: string }> = [
  { key: 'light', word: 'light activity' },
  { key: 'moderate', word: 'moderate activity' },
  { key: 'active', word: 'heavy activity' },
]

const SEX_WORD: Record<string, string> = { male: 'male', female: 'female' }

export const kcal = (n: number) => `${Math.round(n).toLocaleString()}`

/** Height as the user thinks of it: feet/inches for lbs, centimetres for kg. */
export function formatHeight(inches: number, unit: string): string {
  if (!(inches > 0)) return '—'
  if (unit === 'kg') return `${Math.round(inches * 2.54)} cm`
  return `${Math.floor(inches / 12)}' ${Math.round(inches % 12)}"`
}

interface Props {
  basis: types.PlanEnergyBasis
  /** Daily intake the narrative reasons about — the live draft target while
   *  reviewing, or the accepted goal's target once the plan is running.
   *  Falls back to the basis's own target when omitted. */
  calorieTarget?: number
  /** Length of the plan, for the "in approximately XX weeks" clause. Omitted
   *  when there's no trajectory to count. */
  weeks?: number
  weightUnit: string
}

/**
 * The plan's energy picture as a paragraph rather than a table: what the
 * user's body burns at each activity level *before* any deficit, then what
 * their goal implies on top of that.
 *
 * The maintenance-first framing is deliberate. Every other readout in the app
 * shows the deficit number, which is the number people fixate on and the one
 * that makes a plan feel like deprivation — seeing that they'd eat 2,700 kcal
 * just to hold steady is what makes a 2,200 kcal target legible as a choice
 * rather than a punishment.
 */
export default function PlanEnergyNarrative({ basis, calorieTarget, weeks, weightUnit }: Props) {
  const wUnit = weightShort(weightUnit)
  const w = (lbs: number) => `${displayWeight(lbs, weightUnit)} ${wUnit}`
  const target = calorieTarget ?? basis.calorie_target

  const named = NARRATIVE_LEVELS.map(n => ({ ...n, level: basis.levels.find(l => l.key === n.key) })).filter(
    (n): n is typeof n & { level: types.ActivityEnergyLevel } => !!n.level,
  )
  const profileLevel = basis.levels.find(l => l.is_profile_level)
  // The deficit is quoted against the user's own activity level, since that's
  // the maintenance figure their plan was actually built on.
  const maintenance = profileLevel?.maintenance_calories ?? basis.maintenance_calories
  const deficit = target > 0 && maintenance > 0 ? maintenance - target : 0
  const sexWord = SEX_WORD[basis.sex] ?? 'adult'

  return (
    <div className="rounded-lg border border-surface-border bg-surface-overlay p-3 space-y-3">
      <p className="text-xs text-tx-secondary leading-relaxed">
        <Flame className="w-3.5 h-3.5 text-brand-400 inline-block mr-1.5 -mt-0.5" />
        Based on a <strong className="text-tx-primary">{basis.age}-year-old {sexWord}</strong> who is{' '}
        <strong className="text-tx-primary">{formatHeight(basis.height_inches, weightUnit)}</strong> and{' '}
        <strong className="text-tx-primary">{w(basis.current_weight_lbs)}</strong>, daily calories to hold that weight
        steady would be{' '}
        {named.map((n, i) => (
          <span key={n.key}>
            {i > 0 && (i === named.length - 1 ? ' and ' : ', ')}
            <strong className="text-tx-primary">{kcal(n.level.maintenance_calories)}</strong> for {n.word}
          </span>
        ))}
        .
      </p>

      {/* The maintenance figures again as tiles: the sentence explains them,
          but the numbers are what gets glanced at later. */}
      <div className="grid grid-cols-3 gap-2">
        {named.map(n => (
          <div
            key={n.key}
            className={`rounded-lg p-2 text-center border ${
              n.level.is_profile_level ? 'border-brand-500/30 bg-brand-500/5' : 'border-surface-border bg-surface-base'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wide text-tx-muted">{n.level.label}</p>
            <p className="text-sm font-semibold text-tx-primary mt-0.5">{kcal(n.level.maintenance_calories)}</p>
            <p className="text-[10px] text-tx-muted">kcal to maintain</p>
          </div>
        ))}
      </div>

      {target > 0 && deficit > 0 && (
        <p className="text-xs text-tx-secondary leading-relaxed">
          With a goal of <strong className="text-tx-primary">{w(basis.target_weight_lbs)}</strong>
          {weeks && weeks > 0 ? (
            <> in approximately <strong className="text-tx-primary">{weeks} week{weeks === 1 ? '' : 's'}</strong></>
          ) : null},
          that means losing <strong className="text-tx-primary">{w(basis.weight_to_lose_lbs)}</strong> — so at your{' '}
          {(profileLevel?.label ?? basis.activity_level).toLowerCase()} activity level you should aim for a{' '}
          <strong className="text-tx-primary">{kcal(deficit)} calorie deficit</strong>, eating{' '}
          <strong className="text-tx-primary">{kcal(target)} kcal/day</strong> against the {kcal(maintenance)} you burn.
          That works out to about{' '}
          <strong className="text-tx-primary">
            {displayWeight(weeklyLossFromDeficit(deficit), weightUnit)} {wUnit}/week
          </strong>
          .
        </p>
      )}

      {target > 0 && deficit <= 0 && (
        <p className="text-xs text-amber-400 leading-relaxed">
          Eating {kcal(target)} kcal/day is at or above the {kcal(maintenance)} kcal you burn at your activity level, so
          there&rsquo;s no deficit here — this plan won&rsquo;t move you toward {w(basis.target_weight_lbs)}.
        </p>
      )}
    </div>
  )
}
