import { useEffect, useRef } from 'react'
import * as Haptics from 'expo-haptics'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useSettingsStore, useWorkoutSession } from '../../lib/lyftr'
import { useRestTimer } from '../../hooks/useRestTimer'
import { GymModeWorkout } from './GymModeWorkout'
import { SessionPill } from './SessionPill'

const KEEP_AWAKE_TAG = 'lyftr-workout-session'

// One success buzz the moment rest hits zero — you're not looking at the screen mid-
// rest, so the haptic is the cue. ISOLATED in its own null-rendering leaf: useRestTimer
// ticks (setState every ~300ms), and if that tick lived on WorkoutSessionLayer it would
// re-render <GymModeWorkout/> every tick (reloading its images + muscle diagram). Here
// the tick only re-renders this leaf, which renders nothing.
function RestOverHaptic() {
  const { done } = useRestTimer()
  const prevDone = useRef(false)
  useEffect(() => {
    if (done && !prevDone.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    prevDone.current = done
  }, [done])
  return null
}

// Always-mounted session UI layer (mirrors web's Layout): the full-screen gym overlay
// (gym layout + open) over everything, and the minimized session pill (self-hiding).
// Mounted once at the ROOT so both sit above the tab bar — and, being a single always-
// mounted instance, it also owns the session-wide native effects (keep-awake +
// rest-over haptic) so those fire exactly once rather than per banner/pill consumer.
// It deliberately does NOT subscribe to the ticking rest timer itself (that lives in the
// RestOverHaptic leaf) so the gym overlay isn't re-rendered on every countdown tick.
export function WorkoutSessionLayer() {
  const session = useWorkoutSession((s) => s.session)
  const gymOpen = useWorkoutSession((s) => s.gymOpen)
  const layout = useSettingsStore((s) => s.settings.workout_layout)

  // Keep the screen on for the duration of an active session (logging between sets can
  // leave it idle past the lock timeout). Released as soon as the session ends.
  useEffect(() => {
    if (!session) return
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}) }
  }, [!!session])

  return (
    <>
      {session ? <RestOverHaptic /> : null}
      {session && layout === 'gym' && gymOpen ? <GymModeWorkout /> : null}
      <SessionPill />
    </>
  )
}
