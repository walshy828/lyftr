import { useMemo } from 'react'
import { Activity, Flame, Ruler, Scale, SlidersHorizontal } from 'lucide-react'
import * as types from '../types'
import { weightShort, displayWeight } from '../stores/settings'
import { caloriesFromMacros, macroSplit, proteinScenario, weeklyLossFromDeficit } from '../utils/nutritionScenarios'

interface Props {
  basis: types.PlanEnergyBasis
  /** The live (possibly user-edited) draft targets, so every derived figure
   *  below follows the numbers actually about to be saved. */
  targets: { calories: number; protein: number; carbs: number; fat: number }
  weightUnit: string
}

/** Adherence levels offered in the options table — full recommended protein
 *  down to 70%, the range where someone says "I can't eat that much protein"
 *  but hasn't abandoned the idea. */
const ADHERENCE_STEPS = [1, 0.9, 0.8, 0.7]

const SEX_LABEL: Record<string, string> = { male: 'Male', female: 'Female', '': 'Not set' }

function formatHeight(inches: number, unit: string): string {
  if (!(inches > 0)) return '—'
  if (unit === 'kg') return `${Math.round(inches * 2.54)} cm`
  return `${Math.floor(inches / 12)}' ${Math.round(inches % 12)}"`
}

const kcal = (n: number) => `${Math.round(n).toLocaleString()}`

/**
 * The deterministic picture behind a generated plan: who it was computed for,
 * what they burn at each activity level, what deficit the proposed calories
 * actually represent, and what the macro targets look like if the user only
 * partly hits the recommended protein.
 *
 * Everything here is arithmetic — the server-computed `basis` plus the live
 * draft targets. None of it is AI output, which is the point: the user is
 * about to commit to daily numbers and should be able to see where they came
 * from and what the alternatives cost.
 */
export default function PlanBasis({ basis, targets, weightUnit }: Props) {
  const wUnit = weightShort(weightUnit)
  const w = (lbs: number) => `${displayWeight(lbs, weightUnit)} ${wUnit}`

  const macroCalories = caloriesFromMacros(targets)
  const split = macroSplit(targets)
  const scenarios = useMemo(
    () => ADHERENCE_STEPS.map(a => proteinScenario(targets, a, basis.protein.floor_grams)),
    [targets, basis.protein.floor_grams],
  )

  const profileLevel = basis.levels.find(l => l.is_profile_level)
  // The two ways an edited (or AI-proposed) calorie target stops being a good
  // idea: it outruns the safe pace for this BMI, or it drops under the intake
  // floor. Both are shown rather than enforced — the user is making the call,
  // but they shouldn't have to spot it in the table themselves.
  const impliedPace = profileLevel ? weeklyLossFromDeficit(profileLevel.maintenance_calories - targets.calories) : 0
  const paceTooFast = basis.guidance.high_lbs_per_week > 0 && impliedPace > basis.guidance.high_lbs_per_week
  const belowCalorieFloor = targets.calories > 0 && targets.calories < basis.calorie_floor
  const deficitWarning = paceTooFast || belowCalorieFloor
  const proteinInBand = targets.protein >= basis.protein.low_grams && targets.protein <= basis.protein.high_grams
  const fatInBand = targets.fat >= basis.fat.low_grams && targets.fat <= basis.fat.high_grams

  return (
    <div className="space-y-4">
      {/* 1. The recount: what these numbers were computed from. */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-tx-muted mb-2 flex items-center gap-1.5">
          <Ruler className="w-3.5 h-3.5" /> Your profile
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Sex', value: SEX_LABEL[basis.sex] ?? basis.sex },
            { label: 'Age', value: basis.age > 0 ? `${basis.age}` : '—' },
            { label: 'Height', value: formatHeight(basis.height_inches, weightUnit) },
            { label: 'Current weight', value: w(basis.current_weight_lbs) },
            { label: 'Goal weight', value: w(basis.target_weight_lbs) },
            { label: 'To lose', value: w(basis.weight_to_lose_lbs) },
            { label: 'BMI', value: `${basis.bmi.toFixed(1)}`, sub: basis.bmi_category },
            { label: 'Resting burn', value: `${kcal(basis.bmr)} kcal` },
          ].map(f => (
            <div key={f.label} className="rounded-lg p-2.5 bg-surface-overlay border border-surface-border">
              <p className="text-[10px] uppercase text-tx-muted">{f.label}</p>
              <p className="text-sm font-medium text-tx-primary mt-0.5">{f.value}</p>
              {f.sub && <p className="text-[10px] text-tx-muted capitalize">{f.sub}</p>}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-tx-muted mt-2">
          Resting burn is what your body uses at complete rest, from the Mifflin-St Jeor equation. Everything
          below builds on it.
        </p>
      </div>

      {/* 2. Maintenance and recommended intake at every activity level. */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-tx-muted mb-2 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> Calories by activity level
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-tx-muted text-left">
                <th className="py-1.5 pr-3 font-medium">Activity</th>
                <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">Maintain</th>
                <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">To lose at your pace</th>
                <th className="py-1.5 font-medium text-right whitespace-nowrap">This plan gives</th>
              </tr>
            </thead>
            <tbody>
              {basis.levels.map(l => (
                <tr
                  key={l.key}
                  className={`border-t border-surface-border ${l.is_profile_level ? 'bg-brand-500/5' : ''}`}
                >
                  <td className="py-2 pr-3">
                    <span className="text-tx-primary font-medium">{l.label}</span>
                    {l.is_profile_level && <span className="badge badge-dim ml-1.5 text-[9px]">You</span>}
                    <p className="text-[10px] text-tx-muted">{l.description}</p>
                  </td>
                  <td className="py-2 pr-3 text-right text-tx-secondary whitespace-nowrap">{kcal(l.maintenance_calories)}</td>
                  <td className="py-2 pr-3 text-right text-tx-secondary whitespace-nowrap">
                    {kcal(l.intake_low_calories)}–{kcal(l.intake_high_calories)}
                    {l.floor_limited && <span className="block text-[10px] text-amber-400">floor-limited</span>}
                  </td>
                  {/* Deficit is derived from the live calorie target rather
                      than the level's server-computed plan_* fields, which
                      describe the plan as the AI first generated it — edit the
                      target above and this column has to follow. */}
                  <td className="py-2 text-right whitespace-nowrap">
                    {targets.calories < l.maintenance_calories ? (
                      <>
                        <span className="text-tx-primary">−{kcal(l.maintenance_calories - targets.calories)} kcal</span>
                        <span className="block text-[10px] text-tx-muted">
                          ≈ {displayWeight(weeklyLossFromDeficit(l.maintenance_calories - targets.calories), weightUnit)}{' '}
                          {wUnit}/wk
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-400">no deficit</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-tx-muted mt-2">
          &ldquo;To lose at your pace&rdquo; is the intake that produces your recommended{' '}
          {basis.guidance.low_lbs_per_week.toFixed(1)}–{basis.guidance.high_lbs_per_week.toFixed(1)} lbs/week — the
          lower number is the faster end. A floor-limited row means that pace isn&rsquo;t reachable by eating less
          alone at that activity level, without dropping under the {kcal(basis.calorie_floor)} kcal minimum.
        </p>
      </div>

      {/* 3. What the plan's own calorie target amounts to at the user's level. */}
      {profileLevel && (
        <div
          className={`flex items-start gap-2 text-xs rounded-lg p-3 border ${
            deficitWarning
              ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              : 'text-tx-secondary bg-surface-overlay border-surface-border'
          }`}
        >
          <Flame className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${deficitWarning ? '' : 'text-brand-400'}`} />
          <span>
            At your <strong className="text-tx-primary">{profileLevel.label.toLowerCase()}</strong> activity level you
            burn about <strong className="text-tx-primary">{kcal(profileLevel.maintenance_calories)} kcal/day</strong>.
            Eating <strong className="text-tx-primary">{kcal(targets.calories)} kcal</strong> is a{' '}
            <strong className="text-tx-primary">{kcal(profileLevel.maintenance_calories - targets.calories)} kcal</strong>{' '}
            daily deficit — about{' '}
            <strong className="text-tx-primary">
              {displayWeight(weeklyLossFromDeficit(profileLevel.maintenance_calories - targets.calories), weightUnit)}{' '}
              {wUnit}/week
            </strong>
            , against a recommended {basis.guidance.low_lbs_per_week.toFixed(1)}–
            {basis.guidance.high_lbs_per_week.toFixed(1)} lbs/week. Reaching {w(basis.target_weight_lbs)} means losing{' '}
            {w(basis.weight_to_lose_lbs)} in total.
            {paceTooFast && (
              <> That&rsquo;s faster than the pace recommended for your BMI — eating a little more, or moving the goal
                further out, would make it easier to hold onto.</>
            )}
            {belowCalorieFloor && (
              <> It&rsquo;s also under the {kcal(basis.calorie_floor)} kcal/day minimum this app recommends for you.</>
            )}
          </span>
        </div>
      )}

      {/* 4. Macro bands, and what partial protein adherence actually looks like. */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-tx-muted mb-2 flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5" /> Recommended macro ranges
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { name: 'Protein', range: basis.protein, current: targets.protein, inBand: proteinInBand, pct: split.protein },
            { name: 'Fat', range: basis.fat, current: targets.fat, inBand: fatInBand, pct: split.fat },
          ].map(m => (
            <div key={m.name} className="rounded-lg p-3 bg-surface-overlay border border-surface-border">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-tx-primary">{m.name}</p>
                <span className={`badge ${m.inBand ? 'bg-success-500/10 border border-success-500/20 text-success-400' : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'}`}>
                  {m.current} g · {m.inBand ? 'in range' : 'outside range'}
                </span>
              </div>
              <p className="text-xs text-tx-secondary mt-1">
                {m.range.low_grams}–{m.range.high_grams} g/day ({m.range.per_lb_low}–{m.range.per_lb_high} g per lb of{' '}
                {m.range.basis}) · {Math.round(m.pct * 100)}% of calories in this plan
              </p>
              <p className="text-[11px] text-tx-muted mt-1">{m.range.rationale}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-tx-muted mt-2">
          Carbs aren&rsquo;t given a range — they&rsquo;re whatever calories are left after protein and fat, currently{' '}
          {targets.carbs} g ({Math.round(split.carbs * 100)}%). Your macros add up to {kcal(macroCalories)} kcal against
          a {kcal(targets.calories)} kcal target.
        </p>
      </div>

      {/* 5. The options table: the same calories, reshaped for lower protein. */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-tx-muted mb-2 flex items-center gap-1.5">
          <SlidersHorizontal className="w-3.5 h-3.5" /> If you can&rsquo;t hit the protein target
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-tx-muted text-left">
                <th className="py-1.5 pr-3 font-medium">Protein you hit</th>
                <th className="py-1.5 pr-3 font-medium text-right">Protein</th>
                <th className="py-1.5 pr-3 font-medium text-right">Carbs</th>
                <th className="py-1.5 pr-3 font-medium text-right">Fat</th>
                <th className="py-1.5 font-medium text-right">Calories</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map(s => (
                <tr key={s.adherence} className="border-t border-surface-border">
                  <td className="py-2 pr-3 text-tx-primary whitespace-nowrap">
                    {Math.round(s.adherence * 100)}%
                    {s.adherence === 1 && <span className="text-tx-muted"> (as planned)</span>}
                    {s.belowProteinFloor && (
                      <span className="block text-[10px] text-amber-400">below {basis.protein.floor_grams} g minimum</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right text-tx-secondary">{s.protein} g</td>
                  <td className="py-2 pr-3 text-right text-tx-secondary">{s.carbs} g</td>
                  <td className="py-2 pr-3 text-right text-tx-secondary">{s.fat} g</td>
                  <td className="py-2 text-right text-tx-primary">{kcal(s.calories)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-tx-muted mt-2">
          Each row keeps the same calories — the protein you drop moves into carbs and fat, so your deficit and the
          weekly trajectory above stay the same. Protein below about {basis.protein.floor_grams} g/day (0.6 g per lb of
          goal weight) means more of the weight you lose comes from muscle rather than fat. Pick a row you&rsquo;ll
          actually hit and type those numbers into the targets above.
        </p>
      </div>
    </div>
  )
}
