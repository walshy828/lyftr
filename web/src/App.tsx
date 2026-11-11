import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { useAuthStore } from './stores/auth'
import { useSettingsStore } from './stores/settings'
import { hydrateActiveSessionFromServer, startActiveSessionPolling } from './stores/workoutSession'
import Layout from './components/Layout'
// Eager: the login gate and the in-gym workout path, which must render
// instantly with no chunk fetch (gym wifi is not to be trusted mid-set).
import ActiveWorkout from './pages/ActiveWorkout'
import StartWorkout from './pages/StartWorkout'
import Login from './pages/Login'
// Everything else is route-split so heavy deps (recharts on the chart pages,
// react-zxing/react-body-highlighter on the food/exercise flows) stay out of
// the initial bundle.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Workouts = lazy(() => import('./pages/Workouts'))
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'))
const Exercises = lazy(() => import('./pages/Exercises'))
const Plan = lazy(() => import('./pages/Plan'))
const Train = lazy(() => import('./pages/Train'))
const Stats = lazy(() => import('./pages/Stats'))
const WeeklySummary = lazy(() => import('./pages/WeeklySummary'))
const AddProgram = lazy(() => import('./pages/AddProgram'))
const AddAIProgram = lazy(() => import('./pages/AddAIProgram'))
const EditProgram = lazy(() => import('./pages/EditProgram'))
const AddWorkout = lazy(() => import('./pages/AddWorkout'))
const EditWorkout = lazy(() => import('./pages/EditWorkout'))
const WorkoutDetail = lazy(() => import('./pages/WorkoutDetail'))
const ProgramDetail = lazy(() => import('./pages/ProgramDetail'))
const Food = lazy(() => import('./pages/Food'))
const LogFood = lazy(() => import('./pages/LogFood'))
const WeightDetail = lazy(() => import('./pages/WeightDetail'))
const WeightPlan = lazy(() => import('./pages/WeightPlan'))
const BPInsight = lazy(() => import('./pages/BPInsight'))
const PlanCheckin = lazy(() => import('./pages/PlanCheckin'))
const Settings = lazy(() => import('./pages/Settings'))
const Tokens = lazy(() => import('./pages/Tokens'))
const Register = lazy(() => import('./pages/Register'))

/** /programs/12/edit → /routines/12/edit, preserving the query string. */
function LegacyRoutineRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={pathname.replace(/^\/programs/, '/routines') + search} replace />
}

function App() {
  const { isAuthenticated } = useAuthStore()
  const { fetch: fetchSettings, reset: resetSettings } = useSettingsStore()

  useEffect(() => {
    if (isAuthenticated) {
      fetchSettings()
      hydrateActiveSessionFromServer()
      return startActiveSessionPolling()
    } else {
      resetSettings()
    }
  }, [isAuthenticated])

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex justify-center pt-24 text-tx-muted">Loading…</div>}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to="/" /> : <Register />} />

        {/* Protected routes */}
        {isAuthenticated ? (
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            {/* Train: hub, schedule and history. Routines are the reusable
                templates (the API still calls them "programs"). */}
            <Route path="/train" element={<Train />} />
            <Route path="/train/schedule" element={<Plan />} />
            <Route path="/train/history" element={<Workouts />} />
            <Route path="/routines" element={<Navigate to="/train#routines" replace />} />
            <Route path="/routines/new" element={<AddProgram />} />
            <Route path="/routines/ai-new" element={<AddAIProgram />} />
            <Route path="/routines/:id" element={<ProgramDetail />} />
            <Route path="/routines/:id/edit" element={<EditProgram />} />
            <Route path="/workouts/new" element={<AddWorkout />} />
            <Route path="/workouts/:id" element={<WorkoutDetail />} />
            <Route path="/workouts/:id/edit" element={<EditWorkout />} />
            {/* Starting goes through the Train sheet; this route only handles
                the ?program= deep link (Today card, routine page). */}
            <Route path="/workout/start" element={<StartWorkout />} />
            <Route path="/workout/active" element={<ActiveWorkout />} />
            <Route path="/workout/active/exercise/:exerciseId" element={<ExerciseDetail />} />
            <Route path="/exercises" element={<Exercises />} />
            {/* Old paths from before the Train rename; keep bookmarks working. */}
            <Route path="/plan" element={<Navigate to="/train" replace />} />
            <Route path="/plan/schedule" element={<Navigate to="/train/schedule" replace />} />
            <Route path="/schedule" element={<Navigate to="/train/schedule" replace />} />
            <Route path="/workouts" element={<Navigate to="/train/history" replace />} />
            <Route path="/programs" element={<Navigate to="/train#routines" replace />} />
            <Route path="/programs/*" element={<LegacyRoutineRedirect />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/stats/weekly" element={<WeeklySummary />} />
            <Route path="/exercises/:exerciseId" element={<ExerciseDetail />} />
            <Route path="/food" element={<Food />} />
            <Route path="/food/log" element={<LogFood />} />
            {/* Health hub merged into Stats; keep old links working. */}
            <Route path="/health" element={<Navigate to="/stats?tab=weight" replace />} />
            <Route path="/stats/bp/insight" element={<BPInsight />} />
            <Route path="/health/bp/insight" element={<Navigate to="/stats/bp/insight" replace />} />
            {/* Weight moved into the stats hub; keep old links working. */}
            <Route path="/weight" element={<Navigate to="/stats?tab=weight" replace />} />
            <Route path="/weight/plan" element={<WeightPlan />} />
            {/* Before /weight/:id — the wildcard would otherwise swallow it. */}
            <Route path="/weight/checkin" element={<PlanCheckin />} />
            <Route path="/weight/:id" element={<WeightDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/tokens" element={<Tokens />} />
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" />} />
        )}
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
