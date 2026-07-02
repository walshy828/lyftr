import { useCallback, useEffect, useState } from 'react'
import { ScrollView, View, Text, RefreshControl } from 'react-native'
import { Screen, H1, Card, Muted } from '../../src/components/ui'
import { client, useAuthStore, useSettingsStore } from '../../src/lib/lyftr'
import {
  displayWeight,
  weightShort,
  type WeightStats,
  type DailyStats,
} from '@lyftr/shared'

export default function Dashboard() {
  const user = useAuthStore((s) => s.user)
  const settings = useSettingsStore((s) => s.settings)
  const fetchSettings = useSettingsStore((s) => s.fetch)
  const unit = settings.weight_unit

  const [wStats, setWStats] = useState<WeightStats | null>(null)
  const [fStats, setFStats] = useState<DailyStats | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const [w, f] = await Promise.all([
      client.weightAPI.stats().catch(() => null),
      client.foodAPI.stats().catch(() => null),
    ])
    setWStats(w)
    setFStats(f)
  }, [])

  useEffect(() => {
    fetchSettings()
    load()
  }, [fetchSettings, load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const calGoal = settings.calorie_target || 0
  const calNow = fStats?.total_calories ?? 0

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00b8d9" />}
      >
        <View className="gap-6 py-4">
          <View className="gap-1">
            <Muted>Welcome back</Muted>
            <H1>{user?.email?.split('@')[0] ?? 'Athlete'}</H1>
          </View>

          <View className="flex-row gap-4">
            <Card className="flex-1">
              <Muted className="text-xs uppercase">Weight</Muted>
              <Text className="text-tx-primary text-2xl font-bold mt-1">
                {wStats ? displayWeight(wStats.latest, unit) : '—'}
                <Text className="text-tx-muted text-base font-medium"> {weightShort(unit)}</Text>
              </Text>
              {wStats ? (
                <Muted className="text-xs mt-1">
                  {wStats.change_7d >= 0 ? '+' : ''}
                  {displayWeight(wStats.change_7d, unit)} {weightShort(unit)} / 7d
                </Muted>
              ) : null}
            </Card>

            <Card className="flex-1">
              <Muted className="text-xs uppercase">Calories</Muted>
              <Text className="text-tx-primary text-2xl font-bold mt-1">{calNow}</Text>
              <Muted className="text-xs mt-1">of {calGoal} kcal</Muted>
            </Card>
          </View>

          <Card>
            <Muted className="text-xs uppercase">Today's macros</Muted>
            <View className="flex-row justify-between mt-3">
              <Macro label="Protein" value={fStats?.total_protein} goal={settings.protein_target} />
              <Macro label="Carbs" value={fStats?.total_carbs} goal={settings.carb_target} />
              <Macro label="Fat" value={fStats?.total_fat} goal={settings.fat_target} />
            </View>
          </Card>

          <Card>
            <Muted className="text-xs uppercase">Activity</Muted>
            <Text className="text-tx-primary text-lg font-semibold mt-1">
              {fStats?.workout_count ?? 0} workout{(fStats?.workout_count ?? 0) === 1 ? '' : 's'} today
            </Text>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  )
}

function Macro({ label, value, goal }: { label: string; value?: number; goal: number }) {
  return (
    <View className="items-center">
      <Text className="text-tx-primary text-lg font-bold">{value ?? 0}g</Text>
      <Muted className="text-xs">{label}</Muted>
      <Muted className="text-[10px] text-tx-muted">/ {goal}g</Muted>
    </View>
  )
}
