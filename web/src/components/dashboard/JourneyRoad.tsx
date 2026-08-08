import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Map, ArrowRight } from 'lucide-react'
import { format, differenceInCalendarDays } from 'date-fns'
import { SectionHeader } from '../ui'
import * as types from '../../types'
import { displayWeight, weightShort } from '../../stores/settings'
import { usHolidaysBetween } from '../../utils/holidays'
import { interpolateAt, toTimelinePoints } from '../../utils/planProjection'
import { PLAN_COLOR, ACTUAL_COLOR } from '../../utils/chartTheme'

// The road ahead: a weight-loss plan drawn as a journey, with the major US
// holidays it passes through marked with the weight the plan projects for that
// day. "You'll be 198 lb by Thanksgiving" is a far more motivating frame than
// "week 15 of 30", and it turns the holidays people usually dread on a diet
// into waypoints they're travelling toward.
//
// Milestones already passed carry what the user actually weighed near that
// date, so the road doubles as a record rather than only a forecast.

// Geometry. The road is a sine wave sampled as a polyline, so the position of
// any point is pure arithmetic — no getPointAtLength, no ref measurement, no
// layout pass before the markers can be placed. That also makes it testable.
const PAD = 64 // px of road before the first marker and after the last
const STOP_SPACING = 132 // px of road per milestone
const MIN_WIDTH = 520
const HEIGHT = 196
const MID_Y = 96
const AMPLITUDE = 22
const LABEL_WIDTH = 116
const ROAD_SAMPLES = 160

/** A resolved point on the road. */
interface Stop {
  key: string
  name: string
  emoji: string
  date: Date
  t: number // 0..1 along the road
  projected: number | null // lbs, from the plan timeline
  actual: number | null // lbs, nearest real weigh-in (past stops only)
  isPast: boolean
  isGoal?: boolean
}

/** Nearest weigh-in to a date, within `tolerance` days. */
function nearestLogWeight(logs: types.WeightLog[], date: Date, toleranceDays: number): number | null {
  const target = date.getTime()
  const maxMs = toleranceDays * 24 * 60 * 60 * 1000
  let best: { diff: number; weight: number } | null = null
  for (const l of logs) {
    const diff = Math.abs(new Date(l.logged_at).getTime() - target)
    if (diff > maxMs) continue
    if (!best || diff < best.diff) best = { diff, weight: l.weight }
  }
  return best ? best.weight : null
}

export default function JourneyRoad({
  plan, weightLogs, settings,
}: {
  plan: types.CurrentNutritionGoal
  weightLogs: types.WeightLog[]
  settings: types.UserSettings
}) {
  const unit = settings.weight_unit
  const wUnit = weightShort(unit)

  const road = useMemo(() => {
    const timeline = toTimelinePoints(plan.plan_timeline ?? plan.projections ?? [])
    if (timeline.length < 2) return null

    const startTs = timeline[0].ts
    const endTs = timeline[timeline.length - 1].ts
    if (endTs <= startTs) return null

    const span = endTs - startTs
    const now = Date.now()
    const at = (ts: number) => (ts - startTs) / span

    const holidays = usHolidaysBetween(new Date(startTs), new Date(endTs))
    const stops: Stop[] = holidays.map(h => {
      const ts = h.date.getTime()
      const projected = interpolateAt(timeline, ts) ?? null
      const isPast = ts <= now
      return {
        key: h.key,
        name: h.name,
        emoji: h.emoji,
        date: h.date,
        t: at(ts),
        projected,
        // ±4 days: people don't weigh in on the holiday itself.
        actual: isPast ? nearestLogWeight(weightLogs, h.date, 4) : null,
        isPast,
      }
    })

    // The plan's own finish line terminates the road. It isn't a holiday, but
    // a road has to end somewhere, and ending it anywhere else would imply the
    // journey continues past the goal.
    stops.push({
      key: 'goal',
      name: 'Goal',
      emoji: '🏁',
      date: new Date(endTs),
      t: 1,
      projected: plan.goal.target_weight,
      actual: null,
      isPast: endTs <= now,
      isGoal: true,
    })

    const width = Math.max(MIN_WIDTH, PAD * 2 + stops.length * STOP_SPACING)
    // Roughly one full S-bend per two markers: enough curve to read as a road,
    // not so much that the labels start colliding with the crests.
    const waves = Math.max(1, stops.length / 2)

    const x = (t: number) => PAD + Math.min(1, Math.max(0, t)) * (width - PAD * 2)
    const y = (t: number) => MID_Y + AMPLITUDE * Math.sin(Math.min(1, Math.max(0, t)) * waves * 2 * Math.PI)

    /** Polyline path between two positions along the road. */
    const path = (t0: number, t1: number) => {
      if (t1 <= t0) return ''
      const steps = Math.max(2, Math.round(ROAD_SAMPLES * (t1 - t0)))
      let d = ''
      for (let i = 0; i <= steps; i++) {
        const t = t0 + ((t1 - t0) * i) / steps
        d += `${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)} ${y(t).toFixed(1)}`
      }
      return d
    }

    const todayT = Math.min(1, Math.max(0, at(now)))
    const currentWeight = weightLogs.length > 0 ? weightLogs[0].weight : null
    const next = stops.find(s => !s.isPast) ?? null

    // Label placement. Pins sit at their true date, but holidays cluster
    // (Christmas and New Year's are seven days apart on a road that may span a
    // year), so labels get their own x — nudged apart until same-side
    // neighbours clear each other. Labels alternate above/below the road, so
    // only every other one competes for space.
    const labelX: number[] = []
    for (let i = 0; i < stops.length; i++) {
      let lx = x(stops[i].t)
      if (i >= 2) {
        const minGap = LABEL_WIDTH + 8
        lx = Math.max(lx, labelX[i - 2] + minGap)
      }
      labelX.push(lx)
    }
    // A nudge can push the last labels past the edge; shift the whole row back
    // rather than letting one hang off the end of the road.
    const overshoot = labelX.length > 0 ? Math.max(0, Math.max(...labelX) - (width - LABEL_WIDTH / 2)) : 0

    return {
      stops, width, x, y, path, todayT, currentWeight, next,
      labelX: labelX.map(v => v - overshoot),
    }
  }, [plan, weightLogs])

  if (!road) return null

  const { stops, width, x, y, path, todayT, currentWeight, next, labelX } = road

  // The motivating line: what the next milestone looks like from here.
  const nextLine = (() => {
    if (!next?.projected) return null
    const days = differenceInCalendarDays(next.date, new Date())
    if (days < 0) return null
    const weeks = Math.round(days / 7)
    const away = weeks >= 2 ? `${weeks} weeks out` : days <= 1 ? 'tomorrow' : `${days} days out`
    const projDisp = displayWeight(next.projected, unit)
    if (currentWeight === null) {
      return `${next.name} is ${away} — on plan you'll be ${projDisp} ${wUnit}.`
    }
    const delta = currentWeight - next.projected
    if (Math.abs(delta) < 0.5) {
      return `${next.name} is ${away} — on plan you'll be right about where you are now, ${projDisp} ${wUnit}.`
    }
    const verb = delta > 0 ? 'lighter' : 'heavier'
    return `${next.name} is ${away} — on plan you'll be ${projDisp} ${wUnit}, ${displayWeight(Math.abs(delta), unit)} ${wUnit} ${verb} than today.`
  })()

  return (
    <div className="card p-4 sm:p-5">
      <SectionHeader
        icon={Map}
        title="The Road Ahead"
        right={
          <Link to="/weight/plan" className="text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-0.5">
            View plan <ArrowRight className="w-3 h-3" />
          </Link>
        }
        className="mb-1"
      />
      <p className="text-[11px] text-tx-muted mb-2">Where your plan puts you at each milestone</p>

      {/* Horizontal scroll on narrow screens: the road keeps its real width so
          markers never overlap, rather than compressing into an unreadable row. */}
      <div className="overflow-x-auto no-scrollbar -mx-1 px-1">
        <div className="relative" style={{ width, height: HEIGHT }}>
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="absolute inset-0"
            role="img"
            aria-label="Your weight-loss plan drawn as a road through upcoming holidays"
          >
            {/* Road ahead: dashed and dimmed — not travelled yet. */}
            <path d={path(0, 1)} fill="none" stroke="var(--surface-border)" strokeWidth={14} strokeLinecap="round" />
            <path d={path(0, 1)} fill="none" stroke={PLAN_COLOR} strokeWidth={2} strokeOpacity={0.25} strokeDasharray="6 8" strokeLinecap="round" />
            {/* Road travelled: solid. */}
            {todayT > 0 && (
              <>
                <path d={path(0, todayT)} fill="none" stroke={PLAN_COLOR} strokeOpacity={0.22} strokeWidth={14} strokeLinecap="round" />
                <path d={path(0, todayT)} fill="none" stroke={PLAN_COLOR} strokeWidth={2.5} strokeLinecap="round" />
              </>
            )}

            {/* Milestone pins on the road itself, plus a leader line to any
                label that had to be nudged clear of its neighbour. */}
            {stops.map((s, i) => {
              const px = x(s.t)
              const py = y(s.t)
              const lx = labelX[i]
              return (
                <g key={s.key}>
                  {Math.abs(lx - px) > 2 && (
                    <line
                      x1={px} y1={py} x2={lx} y2={py + (i % 2 === 0 ? -12 : 12)}
                      stroke="var(--tx-faint)" strokeWidth={1} strokeDasharray="2 2"
                    />
                  )}
                  <circle
                    cx={px} cy={py} r={5}
                    fill="var(--surface-raised)"
                    stroke={s.isPast ? PLAN_COLOR : 'var(--tx-faint)'}
                    strokeWidth={2.5}
                  />
                </g>
              )
            })}

            {/* "You are here". */}
            <circle cx={x(todayT)} cy={y(todayT)} r={9} fill={ACTUAL_COLOR} fillOpacity={0.2} />
            <circle cx={x(todayT)} cy={y(todayT)} r={4.5} fill={ACTUAL_COLOR} stroke="var(--surface-raised)" strokeWidth={2} />
          </svg>

          {/* Labels as positioned HTML rather than SVG text: real wrapping,
              real theme tokens, real tabular numerals. */}
          {stops.map((s, i) => {
            const above = i % 2 === 0
            const py = y(s.t)
            const lx = labelX[i]
            const style = above
              ? { left: lx - LABEL_WIDTH / 2, bottom: HEIGHT - py + 14, width: LABEL_WIDTH }
              : { left: lx - LABEL_WIDTH / 2, top: py + 14, width: LABEL_WIDTH }
            // Past milestones compare what actually happened to the projection.
            const missedBy = s.actual !== null && s.projected !== null ? s.actual - s.projected : null
            return (
              <div key={s.key} className="absolute text-center" style={style}>
                <div className="text-base leading-none mb-0.5">{s.emoji}</div>
                <p className={`text-[11px] font-semibold leading-tight truncate ${s.isGoal ? 'text-brand-400' : 'text-tx-primary'}`}>
                  {s.name}
                </p>
                <p className="text-[10px] text-tx-muted leading-tight">{format(s.date, 'MMM d')}</p>
                {s.projected !== null && (
                  <p className="text-[11px] font-bold tabular-nums leading-tight" style={{ color: PLAN_COLOR }}>
                    {displayWeight(s.projected, unit)} {wUnit}
                  </p>
                )}
                {missedBy !== null && (
                  <p
                    className="text-[10px] tabular-nums leading-tight"
                    style={{ color: missedBy <= 0.5 ? PLAN_COLOR : '#f59e0b' }}
                    title="What you actually weighed around this date"
                  >
                    {missedBy <= 0.5 ? '✓ ' : '⚠ '}
                    {displayWeight(s.actual as number, unit)} actual
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {nextLine && (
        <p className="text-sm text-tx-secondary mt-2 pt-3 border-t border-surface-border">{nextLine}</p>
      )}
    </div>
  )
}
