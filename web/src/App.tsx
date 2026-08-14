import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
const Programs = lazy(() => import('./pages/Programs'))
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'))
const Exercises = lazy(() => import('./pages/Exercises'))
const Schedule = lazy(() => import('./pages/Schedule'))
const Stats = lazy(() => import('./pages/Stats'))
const AddProgram = lazy(() => import('./pages/AddProgram'))
const AddAIProgram = lazy(() => import('./pages/AddAIProgram'))
const EditProgram = lazy(() => import('./pages/EditProgram'))
const AddWorkout = lazy(() => import('./pages/AddWorkout'))
const EditWorkout = lazy(() => import('./pages/EditWorkout'))
const WorkoutDetail = lazy(() => import('./pages/WorkoutDetail'))
const ProgramDetail = lazy(() => import('./pages/ProgramDetail'))
const Food = lazy(() => import('./pages/Food'))
const LogFood = lazy(() => import('./pages/LogFood'))
const Health = lazy(() => import('./pages/Health'))
const WeightDetail = lazy(() => import('./pages/WeightDetail'))
const WeightPlan = lazy(() => import('./pages/WeightPlan'))
const BPInsight = lazy(() => import('./pages/BPInsight'))
const PlanCheckin = lazy(() => import('./pages/PlanCheckin'))
const Settings = lazy(() => import('./pages/Settings'))
const Tokens = lazy(() => import('./pages/Tokens'))
const Register = lazy(() => import('./pages/Register'))

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
            <Route path="/workouts" element={<Workouts />} />
            <Route path="/workouts/new" element={<AddWorkout />} />
            <Route path="/workouts/:id" element={<WorkoutDetail />} />
            <Route path="/workouts/:id/edit" element={<EditWorkout />} />
            <Route path="/programs" element={<Programs />} />
            <Route path="/programs/new" element={<AddProgram />} />
            <Route path="/programs/ai-new" element={<AddAIProgram />} />
            <Route path="/programs/:id" element={<ProgramDetail />} />
            <Route path="/programs/:id/edit" element={<EditProgram />} />
            <Route path="/workout/start" element={<StartWorkout />} />
            <Route path="/workout/active" element={<ActiveWorkout />} />
            <Route path="/workout/active/exercise/:exerciseId" element={<ExerciseDetail />} />
            {/* Before the :exerciseId route is irrelevant here (react-router ranks
                static segments higher), but keep them adjacent so the pair is obvious. */}
            <Route path="/exercises" element={<Exercises />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/exercises/:exerciseId" element={<ExerciseDetail />} />
            <Route path="/food" element={<Food />} />
            <Route path="/food/log" element={<LogFood />} />
            <Route path="/health" element={<Health />} />
            {/* Before /health/:something — keep the AI report reachable. */}
            <Route path="/health/bp/insight" element={<BPInsight />} />
            {/* Weight moved into the health hub; keep old links working. */}
            <Route path="/weight" element={<Navigate to="/health?tab=weight" replace />} />
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
