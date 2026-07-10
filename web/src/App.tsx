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
const AddProgram = lazy(() => import('./pages/AddProgram'))
const EditProgram = lazy(() => import('./pages/EditProgram'))
const AddWorkout = lazy(() => import('./pages/AddWorkout'))
const EditWorkout = lazy(() => import('./pages/EditWorkout'))
const WorkoutDetail = lazy(() => import('./pages/WorkoutDetail'))
const ProgramDetail = lazy(() => import('./pages/ProgramDetail'))
const Food = lazy(() => import('./pages/Food'))
const LogFood = lazy(() => import('./pages/LogFood'))
const Weight = lazy(() => import('./pages/Weight'))
const WeightDetail = lazy(() => import('./pages/WeightDetail'))
const Settings = lazy(() => import('./pages/Settings'))
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
      <Suspense fallback={<div className="flex justify-center pt-24 text-gray-400">Loading…</div>}>
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
            <Route path="/programs/:id" element={<ProgramDetail />} />
            <Route path="/programs/:id/edit" element={<EditProgram />} />
            <Route path="/workout/start" element={<StartWorkout />} />
            <Route path="/workout/active" element={<ActiveWorkout />} />
            <Route path="/workout/active/exercise/:exerciseId" element={<ExerciseDetail />} />
            <Route path="/exercises/:exerciseId" element={<ExerciseDetail />} />
            <Route path="/food" element={<Food />} />
            <Route path="/food/log" element={<LogFood />} />
            <Route path="/weight" element={<Weight />} />
            <Route path="/weight/:id" element={<WeightDetail />} />
            <Route path="/settings" element={<Settings />} />
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
