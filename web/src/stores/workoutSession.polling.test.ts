import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../services/api', () => ({
  activeSessionAPI: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  programAPI: { get: vi.fn(), update: vi.fn() },
}))

import { activeSessionAPI } from '../services/api'
import { useWorkoutSession, startActiveSessionPolling } from './workoutSession'

const getMock = activeSessionAPI.get as ReturnType<typeof vi.fn>

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('startActiveSessionPolling', () => {
  let stop: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    getMock.mockClear()
    getMock.mockResolvedValue(null)
    setHidden(false)
    useWorkoutSession.setState({ session: null })
  })

  afterEach(() => {
    stop?.()
    stop = null
    vi.useRealTimers()
    setHidden(false)
  })

  it('polls slowly (45s) when there is no active session', async () => {
    stop = startActiveSessionPolling()
    await advance(8000)
    expect(getMock).not.toHaveBeenCalled() // active cadence must not apply
    await advance(37000) // total 45s
    expect(getMock).toHaveBeenCalledTimes(1)
    await advance(45000)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('polls at the active cadence (8s) while a session exists', async () => {
    useWorkoutSession.setState({ session: { name: 'T', exercises: [] } as any })
    stop = startActiveSessionPolling()
    await advance(8000)
    expect(getMock).toHaveBeenCalledTimes(1)
    await advance(8000)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('does not poll at all while the document is hidden', async () => {
    setHidden(true)
    stop = startActiveSessionPolling()
    await advance(10 * 60_000)
    expect(getMock).not.toHaveBeenCalled()
  })

  it('stops polling when the tab becomes hidden and hydrates once on return', async () => {
    useWorkoutSession.setState({ session: { name: 'T', exercises: [] } as any })
    stop = startActiveSessionPolling()
    await advance(8000)
    expect(getMock).toHaveBeenCalledTimes(1)

    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(10 * 60_000)
    expect(getMock).toHaveBeenCalledTimes(1) // nothing while hidden

    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(0)
    expect(getMock).toHaveBeenCalledTimes(2) // immediate catch-up
    await advance(8000)
    expect(getMock).toHaveBeenCalledTimes(3) // chain resumed
  })

  it('collapses visibilitychange + focus firing together into one fetch', async () => {
    stop = startActiveSessionPolling()
    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await advance(0)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('cleanup stops all polling and listeners', async () => {
    stop = startActiveSessionPolling()
    stop()
    stop = null
    await advance(10 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(0)
    expect(getMock).not.toHaveBeenCalled()
  })
})
