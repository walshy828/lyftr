import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import Loading from '../Loading'
import { useDashboardData } from '../../hooks/useDashboardData'
import { useTrainingStats } from '../../hooks/useTrainingStats'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import ThisWeekScorecard from '../dashboard/ThisWeekScorecard'
import InsightsCard from '../dashboard/InsightsCard'
import NutritionTrendCard from '../dashboard/NutritionTrendCard'
import TrainingTrendsCard from '../dashboard/TrainingTrendsCard'
import ConsistencyHeatmap, { type ConsistencySource } from '../dashboard/ConsistencyHeatmap'
import ActivityOverlapCard from '../dashboard/ActivityOverlapCard'
import MuscleMapCard, { MUSCLE_PERIOD_DAYS, type MusclePeriod } from '../dashboard/MuscleMapCard'
import LastWorkoutCard from '../dashboard/LastWorkoutCard'
import PlanAdherenceHero from '../dashboard/PlanAdherenceHero'
import JourneyRoad from '../dashboard/JourneyRoad'

/**
 * Trends → Overview: the cross-domain KPI board. These cards used to sit on
 * the home page; Today now answers "what do I do today", and this tab answers
 * "how is it going" across weeks and months.
 */
export default function OverviewPanel() {
  const d = useDashboardData()
  const [musclePeriod, setMusclePeriod] = useState<MusclePeriod>('week')
  const muscleStats = useTrainingStats(MUSCLE_PERIOD_DAYS[musclePeriod], ['muscles'])
  const [source, setSource] = useState<ConsistencySource>('both')
  const isWide = useMediaQuery('(min-width: 1024px)')

  if (d.loading) return <Loading />
  if (d.error) return <div className="alert-error"><AlertCircle className="w-5 h-5" />{d.error}</div>

  return (
    <div className="space-y-4">
      {d.plan && d.adherence && (
        <PlanAdherenceHero plan={d.plan} adherence={d.adherence} weightStats={d.weightStats} settings={d.settings} />
      )}
      {d.plan && <JourneyRoad plan={d.plan} weightLogs={d.weightLogs} settings={d.settings} />}
      <ThisWeekScorecard
        workouts={d.workouts} cardioSessions={d.cardioSessions} foodHistory={d.foodHistory}
        weightStats={d.weightStats} settings={d.settings} plan={d.plan}
      />
      <InsightsCard workouts={d.workouts} foodHistory={d.foodHistory} weightStats={d.weightStats} settings={d.settings} plan={d.plan} />
      <NutritionTrendCard foodHistory={d.foodHistory} settings={d.settings} />
      <TrainingTrendsCard workouts={d.workouts} />
      <ConsistencyHeatmap
        workoutDaily={d.training?.daily ?? []}
        cardioDaily={d.cardioStats?.daily ?? []}
        streak={source === 'cardio' ? d.cardioStats?.streak : source === 'both' ? d.cardioStats?.combined_streak : d.training?.streak}
        source={source}
        onSourceChange={setSource}
        weeks={isWide ? 52 : 26}
        metric="duration"
      />
      <ActivityOverlapCard workoutDaily={d.training?.daily ?? []} cardioDaily={d.cardioStats?.daily ?? []} />
      <MuscleMapCard muscles={muscleStats.stats?.muscles ?? []} period={musclePeriod} onPeriodChange={setMusclePeriod} />
      <LastWorkoutCard workouts={d.workouts} settings={d.settings} />
    </div>
  )
}
