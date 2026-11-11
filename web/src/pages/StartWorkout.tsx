import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { programAPI } from '../services/api'
import { useWorkoutSession } from '../stores/workoutSession'
import { useStartRoutine } from '../hooks/useStartRoutine'
import Loading from '../components/Loading'

/**
 * /workout/start — a deep link, not a screen. `?program=<id>` starts that
 * routine straight away (the user already pressed Start wherever they came
 * from); anything else, or a workout already running, lands on Train with
 * the start sheet open, which owns resume / pick-a-routine / empty.
 */
export default function StartWorkout() {
  const [params] = useSearchParams()
  const { session } = useWorkoutSession()
  const { startRoutine } = useStartRoutine()
  const id = Number(params.get('program'))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!id || session) return
    programAPI.get(id).then(startRoutine).catch(() => setFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!id || session || failed) return <Navigate to="/train?start=1" replace />
  return <Loading />
}
