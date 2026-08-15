import { lazy, Suspense, type ComponentType } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import Loading from '../components/Loading'

const WeightPanel = lazy(() => import('../components/health/WeightPanel'))
const BloodPressurePanel = lazy(() => import('../components/health/BloodPressurePanel'))
const CardioPanel = lazy(() => import('../components/health/CardioPanel'))

/**
 * The health hub: one page per body metric, selected by tab.
 *
 * Adding a metric — resting HR, waist, sleep — is one entry here plus its
 * panel. The SegmentedControl options, the tab-param validation, and the panel
 * switch all derive from this array, so nothing else has to change.
 */
const TABS: { key: string; label: string; Panel: ComponentType }[] = [
  { key: 'weight', label: 'Weight', Panel: WeightPanel },
  { key: 'bp', label: 'Blood Pressure', Panel: BloodPressurePanel },
  { key: 'cardio', label: 'Cardio', Panel: CardioPanel },
]

const DEFAULT_TAB = TABS[0].key

const SUBTITLES: Record<string, string> = {
  weight: 'Track your body weight over time',
  bp: 'Readings, ranges, and when to measure',
  cardio: 'Runs, rides, and other cardio synced from your watch',
}

export default function Health() {
  // Tabs live in the query string rather than the path: Layout.tsx decides nav
  // active state with an exact `pathname === path` match, so a sub-path like
  // /health/bp would silently un-highlight the Health nav item.
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab = TABS.some(t => t.key === raw) ? raw! : DEFAULT_TAB

  const setTab = (next: string) => {
    // replace so flipping tabs doesn't stack history entries — the phone back
    // button should leave the page, not walk back through tab changes.
    setParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('tab', next)
      return p
    }, { replace: true })
  }

  const active = TABS.find(t => t.key === tab)!

  return (
    <div className="space-y-5 animate-slide-up">
      <PageHeader title="Health" subtitle={SUBTITLES[tab]} />

      <SegmentedControl
        options={TABS.map(t => ({ value: t.key, label: t.label }))}
        value={tab}
        onChange={setTab}
      />

      {/* Only the active panel mounts, so the inactive one never fires its fetches. */}
      <Suspense fallback={<Loading />}>
        <active.Panel />
      </Suspense>
    </div>
  )
}
