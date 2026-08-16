import { describe, it, expect } from 'vitest'
import { cardioWeightedDuration, mergeConsistencyValue } from './ConsistencyHeatmap'
import type { CardioDay, TrainingDay } from '../../types'

const minutes = (m: number) => m * 60

describe('cardioWeightedDuration', () => {
  it('returns 0 for no duration', () => {
    expect(cardioWeightedDuration(0)).toBe(0)
  })

  it('rounds a short session up within the grace window', () => {
    expect(cardioWeightedDuration(minutes(13))).toBe(minutes(15))
    expect(cardioWeightedDuration(minutes(14))).toBe(minutes(15))
  })

  it('does not round up a session outside the grace window', () => {
    expect(cardioWeightedDuration(minutes(12))).toBe(0)
  })

  it('gives a single weight unit for an 18 minute session', () => {
    expect(cardioWeightedDuration(minutes(18))).toBe(minutes(15))
  })

  it('gives two weight units for a 30 minute session', () => {
    expect(cardioWeightedDuration(minutes(30))).toBe(minutes(30))
  })

  it('gives two weight units for a 28 minute session (within grace of 30)', () => {
    expect(cardioWeightedDuration(minutes(28))).toBe(minutes(30))
  })

  it('gives only one weight unit for a 27 minute session (outside grace of 30)', () => {
    expect(cardioWeightedDuration(minutes(27))).toBe(minutes(15))
  })
})

describe('mergeConsistencyValue cardio weighting', () => {
  const cardioDay = (duration: number): CardioDay => ({
    date: '2026-08-16',
    sessions: 1,
    duration,
    distance_meters: 0,
    calories: 0,
  })

  it('uses weighted duration for the cardio source under the duration metric', () => {
    expect(mergeConsistencyValue(undefined, cardioDay(minutes(28)), 'cardio', 'duration')).toBe(minutes(30))
  })

  it('uses raw session count for the workouts metric, unaffected by weighting', () => {
    expect(mergeConsistencyValue(undefined, cardioDay(minutes(28)), 'cardio', 'workouts')).toBe(1)
  })

  it('blends weighted cardio with raw workout duration for the both source', () => {
    const workoutDay: TrainingDay = { date: '2026-08-16', workouts: 1, duration: minutes(20), volume: 0, sets: 0, exercises: 0 }
    expect(mergeConsistencyValue(workoutDay, cardioDay(minutes(28)), 'both', 'duration')).toBe(minutes(20) + minutes(30))
  })
})
