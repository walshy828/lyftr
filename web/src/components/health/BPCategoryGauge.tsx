import { BP_CATEGORIES } from '../../utils/bloodPressure'
import type { BPCategory } from '../../types'

interface Props {
  /** The 30-day average systolic — the number the category is actually based on. */
  avgSystolic: number
  /** The most recent single reading, shown as a ghost marker for context. */
  latestSystolic?: number
  category: BPCategory
}

/**
 * Where the user falls on the ACC/AHA scale.
 *
 * The marker sits at the *average*, not the latest reading. That's the whole
 * point of the component: single-reading classification is how a tracker
 * manufactures anxiety, since day-to-day swings of 5-10 mmHg are normal and
 * enough to cross a boundary. The latest reading appears as a secondary tick so
 * the two are visibly different things.
 *
 * Bands are proportional to the systolic scale below; diastolic is deliberately
 * not represented here — one axis, one story.
 */

const SCALE_MIN = 90
const SCALE_MAX = 180

const BANDS: { to: number; key: Exclude<BPCategory, 'low' | 'crisis'> }[] = [
  { to: 120, key: 'normal' },
  { to: 130, key: 'elevated' },
  { to: 140, key: 'stage1' },
  { to: SCALE_MAX, key: 'stage2' },
]

const pct = (v: number) =>
  Math.min(100, Math.max(0, ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100))

export default function BPCategoryGauge({ avgSystolic, latestSystolic, category }: Props) {
  const meta = BP_CATEGORIES[category]

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs text-tx-muted">Where your average falls</span>
        <span className={`badge border ${meta.chip}`}>{meta.label}</span>
      </div>

      <div className="relative h-7">
        <div className="absolute inset-x-0 top-2 flex h-3 rounded-full overflow-hidden">
          {BANDS.map((b, i) => {
            const from = i === 0 ? SCALE_MIN : BANDS[i - 1].to
            return (
              <div
                key={b.key}
                style={{
                  width: `${((b.to - from) / (SCALE_MAX - SCALE_MIN)) * 100}%`,
                  backgroundColor: BP_CATEGORIES[b.key].hex,
                  opacity: category === b.key ? 0.85 : 0.28,
                }}
              />
            )
          })}
        </div>

        {latestSystolic !== undefined && (
          <div
            className="absolute top-1 w-0.5 h-5 bg-tx-muted/50 rounded-full"
            style={{ left: `${pct(latestSystolic)}%` }}
            aria-hidden
          />
        )}

        <div
          className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
          style={{ left: `${pct(avgSystolic)}%` }}
          data-testid="bp-gauge-marker"
        >
          <div className="w-1 h-7 rounded-full bg-tx-primary shadow-card" />
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-tx-muted mt-1 tabular-nums">
        <span>{SCALE_MIN}</span>
        <span>120</span>
        <span>130</span>
        <span>140</span>
        <span>{SCALE_MAX}+</span>
      </div>

      <p className="text-[11px] text-tx-muted mt-2 leading-relaxed">
        Based on your average, not your latest reading — a single measurement
        swings enough on its own to cross a boundary.
      </p>
    </div>
  )
}
