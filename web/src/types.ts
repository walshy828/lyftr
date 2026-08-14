export interface User {
  id: number
  email: string
  name: string
  created_at: string
  updated_at?: string
}

export interface UserSettings {
  user_id: number
  weight_unit: 'lbs' | 'kg'
  calorie_target: number
  protein_target: number
  carb_target: number
  fat_target: number
  cholesterol_target: number
  sodium_target: number
  food_allergies: string
  food_dislikes: string
  food_likes: string
  // Remembered vantage point for the weight-plan progress view — 'YYYY-MM-DD',
  // or '' meaning "start from the journey start" (first accepted plan).
  plan_history_start: string
  /** Consent to send health data (BP history, body metrics) to the configured third-party LLM. */
  ai_health_insights_opt_in: boolean
  /** How long a device the user chose to remember stays signed in. Bounded server-side by MAX_SESSION_DAYS. */
  session_max_days: number
  /**
   * Whether the session UI collects a per-set effort rating, and on which
   * scale. Both persist to the same `set.rpe` field — RIR is stored inverted
   * as `10 - rir` — so the number means one thing however it was entered.
   */
  track_effort: '' | 'rpe' | 'rir'
  workout_layout?: 'list' | 'gym'
  // Client-only (localStorage, not persisted server-side):
  rest_enabled?: boolean        // master rest-timer on/off
  rest_seconds_default?: number // default rest seconds, seeds new exercises
  /** Which external food databases the Log Food search queries. Never empty. */
  food_search_sources?: FoodSource[]
}

export interface Exercise {
  id: number
  name: string
  muscle_group: string
  secondary_muscles: string[]
  category: string
  equipment: string
  description: string
  image_url?: string
  video_url?: string
  /** End of the movement. With image_url it animates the lift. */
  image_url_end?: string
  /** Real animated GIF, only present on libraries seeded with EXERCISE_LIBRARY_SOURCE=gymvisual. */
  gif_url?: string
  force?: string
  level?: string
  mechanic?: string
  /** Which library this row belongs to: "free", "gymvisual", or "lyftr" (the
   *  app's own always-present cardio carve-out — see QuickCardioModal). */
  source?: string
  /** Upstream dataset slug; the media cache keys on it. */
  source_id?: string
}

export interface Set {
  id?: number
  set_number: number
  reps: number
  weight: number
  duration?: number  // seconds — cardio/timed sets
  distance?: number  // meters — cardio sets
  steps?: number     // step count — cardio sets (walks/runs)
  rpe?: number
  is_warmup?: boolean
  // Absent on legacy rows / manual add-edit sets — treat as completed.
  completed?: boolean
}

export interface WorkoutExercise {
  id?: number
  workout_id?: number
  exercise_id: number
  order_index?: number
  notes?: string
  exercise: Exercise
  rest_seconds?: number
  sets: Set[]
}

export interface Workout {
  id: number
  user_id?: number
  name: string
  notes?: string
  duration: number
  started_at: string
  created_at: string
  program_id?: number
  feeling?: number // 0/undefined=unrated, 1=light, 2=moderate, 3=intense
  exercises: WorkoutExercise[]
}

export interface WeightLog {
  id: number
  user_id?: number
  weight: number
  notes?: string
  logged_at: string
  created_at?: string
}

// Blood pressure (#bloodPressure)

/** ACC/AHA 2017 categories, plus 'low' which is advisory only. */
export type BPCategory = 'low' | 'normal' | 'elevated' | 'stage1' | 'stage2' | 'crisis'

export type BPContext = 'morning' | 'evening' | 'post_workout' | 'post_meal' | 'stressed' | 'other'

export interface BloodPressureLog {
  id: number
  user_id?: number
  systolic: number
  diastolic: number
  pulse?: number
  context?: BPContext
  arm?: 'left' | 'right'
  position?: 'seated' | 'standing' | 'lying'
  rested: boolean
  notes?: string
  /** Minutes east of UTC at capture time — lets the server answer "was this a morning reading?". */
  tz_offset: number
  logged_at: string
  created_at?: string
  /** Derived server-side, never stored. Authoritative over any client classification. */
  category: BPCategory
}

export interface LogBloodPressureRequest {
  systolic: number
  diastolic: number
  pulse?: number
  context?: BPContext | ''
  arm?: 'left' | 'right' | ''
  position?: 'seated' | 'standing' | 'lying' | ''
  rested?: boolean
  notes?: string
  tz_offset?: number
  logged_at?: string
}

/** One rolling window of daily averages (7 / 30 / 90 days). */
export interface BPWindow {
  days: number
  avg_systolic: number
  avg_diastolic: number
  avg_pulse?: number
  /** Empty string when the window has no data — never a false 'normal'. */
  category: BPCategory | ''
  readings: number
  sessions: number
  days_with_data: number
  max_systolic: number
  max_diastolic: number
  worst_category: BPCategory | ''
  sys_std_dev: number
}

/** One local calendar day, averaged across its measurement occasions. */
export interface BPDay {
  day: string
  systolic: number
  diastolic: number
  pulse?: number
  sessions: number
  readings: number
  category: BPCategory
  morning: boolean
  evening: boolean
}

export interface BPTrend {
  sys_per_30d: number
  dia_per_30d: number
  /** Empty string when there isn't enough data to fit a slope. */
  label: 'improving' | 'stable' | 'worsening' | ''
  points: number
}

export interface BPNudge {
  key: string
  title: string
  detail: string
  severity: 'info' | 'warn' | 'urgent'
}

export interface BPStats {
  latest: BloodPressureLog | null
  windows: BPWindow[]
  daily: BPDay[]
  trend: BPTrend
  nudges: BPNudge[]
  total_readings: number
  lookback_days: number
}

export interface BPContributor {
  factor: string
  direction: 'helping' | 'hurting' | 'unclear'
  evidence: string
  strength: 'strong' | 'moderate' | 'weak'
}

export interface BPActionStep {
  title: string
  detail: string
  why_it_works: string
  effort: 'easy' | 'moderate' | 'hard'
  horizon: 'this week' | 'this month' | 'ongoing'
}

export interface BPInsightReport {
  headline: string
  where_you_stand: string
  trend_reading: string
  contributors: BPContributor[]
  action_plan: BPActionStep[]
  measurement_tips: { title: string; detail: string }[]
  /** Empty unless something genuinely warrants escalation. */
  see_a_doctor: string
  outlook: string
}

export interface BPInsightFacts {
  generated_at: string
  latest?: BloodPressureLog
  windows: BPWindow[]
  daily: BPDay[]
  category: BPCategory | ''
  worst_category: BPCategory | ''
  trend_label: string
  sys_per_30d: number
  dia_per_30d: number
  nudges: BPNudge[]
  weight: {
    current_lbs: number
    change_30d_lbs: number
    change_90d_lbs: number
    bmi_category: string
    entries: number
  }
  training: { workout_days_30: number; workout_days_90: number }
  nutrition: { avg_sodium_mg: number; sodium_target_mg: number; days_logged_30: number }
  bmi: number
  other_metrics?: MetricSummary[]
}

export interface BPInsight {
  id: number
  created_at: string
  facts: BPInsightFacts | null
  /** Null when no AI provider was configured, or the call failed. */
  report: BPInsightReport | null
}

/** Uniform card-level readout of any tracked health metric. */
export interface MetricSummary {
  key: string
  label: string
  value: string
  unit: string
  category: string
  tone: 'good' | 'watch' | 'bad' | 'neutral'
  change: number
  change_window_days: number
  lower_is_better: boolean
  last_logged_at: string
  readings: number
}

export interface FoodLog {
  id: number
  user_id?: number
  name: string
  brand?: string
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks'
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  sugar?: number
  sodium?: number
  cholesterol?: number
  servings: number
  serving_size?: string
  /** Mass of one serving in grams; 0/undefined means unknown or not mass-based. */
  serving_size_grams?: number
  /** Volume of one serving in ml, for foods measured by volume rather than mass. */
  serving_size_ml?: number
  barcode?: string
  image_url?: string
  source?: 'off' | 'fdc' | 'saved' | 'manual' | 'photo' | 'ai'
  logged_at: string
  created_at?: string
}

// A frequently-used food for the Log Food "Recent" tab: the most-recent logged
// entry for a distinct food, plus how many times it was logged in the window.
export interface RecentFood extends FoodLog {
  log_count: number
}

export interface DailyStats {
  date: string
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_fiber: number
  total_sodium: number
  total_cholesterol: number
  workout_count: number
}

/**
 * A household measure a food source publishes, with its exact mass — e.g.
 * { label: '1 tbsp', grams: 13.8 }. Only present when the source stated the
 * gram weight; we never derive one, since that needs a density we don't have.
 */
export interface FoodPortion {
  label: string
  grams: number
  /**
   * The volume the label names, when it names one — the 15 in "1 tbsp". A
   * portion carrying both numbers is this food's published density, which is
   * what makes cups and spoons exact units for it rather than estimates.
   */
  ml?: number
}

/**
 * An external food database the search can be narrowed to. Deliberately only
 * the upstreams — 'saved'/'manual'/'ai' are result origins, not things you can
 * ask the search endpoint for.
 */
export type FoodSource = 'off' | 'fdc'

export interface FoodSearchResult {
  name: string
  brand?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar?: number
  sodium?: number
  cholesterol?: number
  serving_size: string
  /** Mass the quoted nutrition numbers describe; 0/undefined means unknown. */
  serving_size_grams?: number
  /** Volume those same numbers describe, for volume-based foods; 0 = unknown. */
  serving_size_ml?: number
  portions?: FoodPortion[]
  image_url?: string
  source: 'off' | 'fdc' | 'saved' | 'manual' | 'photo' | 'ai'
  /**
   * True when these numbers came off a real Nutrition Facts panel rather than
   * a per-100g figure or an AI estimate. Drives the provenance badge.
   */
  label_accurate?: boolean
  /** The GTIN this result was resolved from, when it came from a scan. */
  barcode?: string
  /** USDA publication date for the label data — informational. */
  label_date?: string
}

export interface NutritionExtraction {
  name?: string
  brand?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  sodium: number
  cholesterol: number
  serving_size?: string
}

export interface MealItem {
  name: string
  quantity?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  sodium: number
  cholesterol: number
  serving_size?: string
}

export interface MealRecommendation {
  title: string
  description: string
  items: MealItem[]
}

export interface MealPhotoItem extends MealItem {
  confidence?: 'high' | 'medium' | 'low'
  portion_reasoning?: string
}

export interface MealPhotoAnalysis {
  items: MealPhotoItem[]
  assessment?: string
  image_url: string
}

export interface SavedFood {
  id: number
  name: string
  brand?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar?: number
  sodium?: number
  cholesterol?: number
  serving_size: string
  serving_size_grams?: number
  serving_size_ml?: number
  barcode?: string
  image_url?: string
}

export interface FoodHistoryPoint {
  date: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface WeightStats {
  latest: number
  starting: number
  min: number
  max: number
  avg: number
  total_entries: number
  change_7d: number
  change_30d: number
}

export interface UserProfile {
  user_id: number
  birth_date: string // 'YYYY-MM-DD', '' if unset
  sex: '' | 'male' | 'female'
  height_inches: number
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
}

export interface WeeklyLossGuidance {
  low_lbs_per_week: number
  high_lbs_per_week: number
  note: string
}

export interface BMIInfo {
  bmi: number
  category: 'unknown' | 'underweight' | 'healthy' | 'overweight' | 'obese'
  healthy_range_low: number
  healthy_range_high: number
  obese_min_lbs: number
  loss_guidance: WeeklyLossGuidance
}

export interface ProfileWithBMI extends UserProfile {
  age: number // computed server-side from birth_date as of now
  bmi: BMIInfo
}

// PlanSection is one headed group of bullets in a structured plan write-up.
// The AI returns these instead of one prose blob so the UI can render real
// headings and lists without a markdown parser.
export interface PlanSection {
  heading: string
  bullets: string[]
}

export interface PlanDetail {
  summary: string
  sections: PlanSection[]
}

export interface NutritionGoal {
  id: number
  user_id: number
  calorie_target: number
  protein_target: number
  carb_target: number
  fat_target: number
  target_weight: number
  source: 'ai'
  // notes is the flattened plain-text form; prefer `detail` when present.
  notes: string
  // detail is absent on goals accepted before structured plan text existed —
  // fall back to rendering `notes` as a paragraph.
  detail?: PlanDetail
  effective_at: string
  created_at: string
}

export interface WeightPlanProjectionPoint {
  week: number
  expected_weight: number
  expected_date?: string
}

// ActivityEnergyLevel is one row of the "what would I need to eat at this
// activity level" table. Every level is returned, not just the user's own, so
// they can see what training more or less would do to their intake.
export interface ActivityEnergyLevel {
  key: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
  label: string
  description: string
  multiplier: number
  maintenance_calories: number
  // Intake window that produces the safe pace band — the low calorie figure
  // is the *faster* end of the band (bigger deficit).
  intake_low_calories: number
  intake_high_calories: number
  // The safe pace would require eating under the app's minimum at this level,
  // so the window was raised to the floor — that pace isn't reachable by diet
  // alone here.
  floor_limited: boolean
  plan_deficit_calories: number
  plan_lbs_per_week: number
  is_profile_level: boolean
}

export interface MacroRange {
  low_grams: number
  high_grams: number
  per_lb_low: number
  per_lb_high: number
  basis: string
  rationale: string
  // Below this, cutting the macro starts costing something real (lean mass
  // for protein, hormone function for fat).
  floor_grams: number
}

// PlanEnergyBasis is the deterministic, non-AI arithmetic behind a generated
// plan: who it was computed for, what they burn, what each activity level
// implies, and the macro bands a sensible plan sits in.
export interface PlanEnergyBasis {
  sex: '' | 'male' | 'female'
  age: number
  height_inches: number
  current_weight_lbs: number
  target_weight_lbs: number
  weight_to_lose_lbs: number
  bmi: number
  bmi_category: BMIInfo['category']
  activity_level: UserProfile['activity_level']
  bmr: number
  calorie_floor: number
  levels: ActivityEnergyLevel[]
  maintenance_calories: number
  calorie_target: number
  plan_deficit_calories: number
  plan_lbs_per_week: number
  guidance: WeeklyLossGuidance
  protein: MacroRange
  fat: MacroRange
}

export interface DraftWeightPlan {
  calorie_target: number
  protein_target: number
  carb_target: number
  fat_target: number
  weekly_trajectory: WeightPlanProjectionPoint[]
  rationale: string
  safety_notes: string
  detail?: PlanDetail
  // Computed server-side from the profile, not by the AI. Absent from plans
  // generated before this existed.
  basis?: PlanEnergyBasis
}

export interface CurrentNutritionGoal {
  goal: NutritionGoal
  projections: WeightPlanProjectionPoint[]
  // plan_timeline is the "Plan" line stitched across every goal the user has
  // ever accepted, each clipped to the window it was active for — use this
  // (not `projections`, which is only the latest goal) for the chart.
  plan_timeline: WeightPlanProjectionPoint[]
  // actual_forecast is a clamped linear projection of where the user's
  // actual weight trend is headed, or [] if there isn't enough data yet.
  actual_forecast: WeightPlanProjectionPoint[]
  // original_plan is the *first* accepted plan's trajectory, deliberately
  // unclipped (unlike plan_timeline) so it can be drawn as the "where I
  // originally said I'd be" reference line. [] when the current plan is the
  // original one.
  original_plan: WeightPlanProjectionPoint[]
  journey_start: string
  // The plan's energy arithmetic recomputed against the user's *current*
  // weight (not the weight they had when they accepted it). null when the
  // profile is too incomplete to compute from — no height, birth date, or
  // logged weight.
  basis?: PlanEnergyBasis | null
}

// One weekly bucket of the locked progress record: what the plan in force
// that week said the user should weigh vs. what they actually weighed.
export interface WeightPlanHistoryWeek {
  week_start: string
  week: number
  target_weight: number
  actual_weight: number
  has_actual: boolean
  goal_id: number
  variance_lbs: number
}

// One accepted plan's stretch of the record: promised pace vs. achieved pace.
export interface WeightPlanSegment {
  goal_id: number
  from: string
  to: string
  weeks: number
  start_weight: number
  end_weight: number
  target_lbs_per_week: number
  actual_lbs_per_week: number
  is_current: boolean
}

export interface WeightPlanHistory {
  journey_start: string
  from: string
  weeks: WeightPlanHistoryWeek[]
  segments: WeightPlanSegment[]
}

export interface WeightPlanAdherence {
  behind_plan: boolean
  variance_lbs: number
  drivers: string[]
  motivational_note: string
  days_logged_food: number
  logging_window: number // size of the rolling window days_logged_food is counted over
  avg_calories: number
  workouts_last_7d: number
  weeks_into_plan: number
  should_regenerate: boolean
  regenerate_reason: string
}

// --- Progress check-in -----------------------------------------------------
// A user-triggered coaching review of the whole journey. `facts` is computed
// server-side and always present; `report` is the AI narrative and is null
// when no provider is configured or the call failed — the page renders every
// fact either way.

export type CheckinPattern =
  | 'ahead' | 'steady' | 'accelerating' | 'slowing' | 'stalled' | 'regaining'

// One rolling-window slice of logging/training consistency. avg_calories and
// avg_protein are averaged over days that were actually logged, not over the
// whole window — a blank day is a missing measurement, not a zero.
export interface PlanCheckinWindow {
  days: number
  food_logged_days: number
  workout_days: number
  avg_calories: number
  avg_protein: number
  calorie_target: number
  protein_target: number
}

export interface PlanCheckinFacts {
  generated_at: string
  weeks_into_plan: number
  plan_start: string
  plan_end: string
  journey_start: string

  start_weight: number
  current_weight: number
  target_weight: number
  expected_weight_now: number
  variance_lbs: number // magnitude; behind_plan carries the direction
  behind_plan: boolean
  lost_lbs: number
  pct_body_weight_lost: number

  // Both in lbs LOST per week: positive = losing, negative = gaining.
  // `overall` spans the whole weigh-in record; `recent` just the last
  // recent_window_days. The contrast between them is the point of the feature.
  overall_lbs_per_week: number
  recent_lbs_per_week: number
  recent_window_days: number
  plan_lbs_per_week: number
  pattern: CheckinPattern

  projected_goal_date: string // zero-time when the trend never reaches the goal
  days_vs_plan_goal_date: number // + = later than the plan, - = earlier

  adherence: PlanCheckinWindow[]
  weekly_variance: WeightPlanHistoryWeek[]

  basis?: PlanEnergyBasis | null
  bmi: BMIInfo
  profile: UserProfile
}

// A peer-comparison row. These figures come from the AI, not from the app —
// the prompt constrains them to ranges rather than point estimates.
export interface CheckinBenchmark {
  label: string
  user_value: string
  typical_range: string
  verdict: 'ahead' | 'typical' | 'behind'
  context: string
}

export interface CheckinPoint {
  title: string
  detail: string
}

export interface CheckinRecommendation {
  title: string
  detail: string
  why_it_works: string
  effort: 'easy' | 'moderate' | 'hard'
}

export interface PlanCheckinReport {
  headline: string
  overall_assessment: string
  recent_assessment: string
  benchmarks: CheckinBenchmark[]
  whats_working: CheckinPoint[]
  whats_slipping: CheckinPoint[]
  recommendations: CheckinRecommendation[]
  what_works_generally: CheckinPoint[]
  outlook: string
}

export interface PlanCheckin {
  id: number
  user_id: number
  goal_id: number
  created_at: string
  facts: PlanCheckinFacts | null
  report: PlanCheckinReport | null
}

export interface ProgramSet {
  id?: number
  set_number: number
  target_reps: number
  target_weight: number
}

export interface ProgramExercise {
  id?: number
  exercise_id: number
  order_index?: number
  notes?: string
  exercise: Exercise
  rest_seconds?: number
  sets: ProgramSet[]
}

export interface Program {
  id: number
  user_id: number
  name: string
  notes?: string
  is_shared: boolean
  owner_email?: string
  created_at: string
  last_used_at?: string
  exercises: ProgramExercise[]
}

export type ProgramSort = 'smart' | 'name' | 'created'

export interface DraftProgramSet {
  set_number: number
  target_reps: number
  target_weight: number
}

export interface DraftProgramExercise {
  exercise_id: number
  notes?: string
  rest_seconds?: number
  sets: DraftProgramSet[]
}

export interface DraftProgram {
  name: string
  notes?: string
  exercises: DraftProgramExercise[]
}

export interface ActiveSessionSet {
  set_number: number
  target_reps: number
  target_weight: number
  actual_reps: number
  actual_weight: number
  // Cardio fields (present on sets belonging to a category === 'cardio'
  // exercise). Duration in seconds, distance in meters — canonical units,
  // converted to the display unit only in the UI. Absent/0 on strength sets.
  actual_duration?: number
  actual_distance?: number
  actual_steps?: number
  /**
   * Per-set effort, stored on the RPE scale (1-10) regardless of which scale
   * the user entered it on; RIR is converted as `10 - rir`. 0/absent means
   * "not rated". Only collected when settings.track_effort is on.
   */
  rpe?: number
  completed: boolean
}

export interface ActiveSessionExercise {
  exercise_id: number
  exercise: Exercise
  notes: string
  rest_seconds?: number
  sets: ActiveSessionSet[]
}

export interface ActiveSession {
  program_id?: number
  name: string
  started_at: string
  exercises: ActiveSessionExercise[]
  device_id?: string
  // Current position and rest-timer state, synced to the server so a
  // Wear OS watch (via the Android companion app) can mirror what phase of
  // the workout the session is in without its own copy of the gym-mode UI logic.
  current_exercise_idx?: number
  current_set_idx?: number
  rest_ends_at?: number | null
  rest_duration_sec?: number | null
}

export interface AuthResponse {
  token: string
  refresh_token: string
  user: User
}

export interface PersonalRecord {
  weight: number
  reps: number
  estimated_1rm: number
  date: string
  workout_id: number
}

/** An exercise's current best set, with when it was achieved. */
export interface RecentPR {
  exercise_id: number
  exercise_name: string
  muscle_group: string
  weight: number
  reps: number
  estimated_1rm: number
  date: string
  workout_id: number
}

/** One program's slot on a scheduled day. */
export interface ScheduledProgram {
  program_id: number
  name: string
  exercise_count: number
  order_index: number
  /** Set when a workout for this program was already logged on this date. */
  completed_workout_id?: number
}

/**
 * Why a day looks the way it does. 'override' means this specific date was
 * changed without touching the weekly pattern; 'rest' means nothing is planned
 * (either no pattern for that weekday, or an explicit rest override).
 */
export type ScheduleSource = 'recurring' | 'override' | 'rest'

export interface ScheduledDay {
  date: string
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number
  source: ScheduleSource
  programs: ScheduledProgram[]
}

/** The recurring weekly pattern, keyed by weekday number. */
export type RecurringSchedule = Record<string, ScheduledProgram[]>

export interface ScheduleResponse {
  from: string
  to: string
  days: ScheduledDay[]
  recurring: RecurringSchedule
}

/** The filterable fields of the exercise library. */
export type ExerciseFacetKey =
  | 'muscle_group' | 'equipment' | 'category' | 'level' | 'mechanic' | 'force'

export interface FacetValue {
  value: string
  count: number
}

/** Distinct filter values with global counts, keyed by field. */
export type ExerciseFacets = Partial<Record<ExerciseFacetKey, FacetValue[]>>

/** One proposed (or manually resolved) old->new exercise mapping row in an
 *  exercise-library migration — see backend stores.MigrationMappingEntry. */
export interface ExerciseMigrationMappingEntry {
  old_exercise_id: number
  old_name: string
  matched_name?: string
  new_exercise_id?: number
  confidence: 'high' | 'medium' | 'low' | string
  reasoning?: string
  leave_unmigrated: boolean
}

/** One exercise_migrations row — a preview, or a confirmed/failed record. */
export interface ExerciseMigration {
  id: number
  from_source: string
  to_source: string
  status: 'proposed' | 'applied' | 'failed' | string
  mapping: ExerciseMigrationMappingEntry[]
  applied_by?: string
  error?: string
  started_at: string
  completed_at?: string
}

export interface ExerciseMigrationStatus {
  current_source: string
  latest_migration?: ExerciseMigration
}

export interface ExerciseMigrationResult {
  applied: boolean
  from_source: string
  to_source: string
  migrated: number
  message: string
}

/** Query params accepted by the exercise list endpoint. */
export type ExerciseQuery = Partial<Record<ExerciseFacetKey, string>> & {
  q?: string
  limit?: number
}

export interface ExerciseHistoryPoint {
  date: string
  max_weight: number
  total_volume: number
  sets_count: number
  total_reps: number
  /**
   * Estimated 1RM of the session's best set. 0 for bodyweight and cardio work,
   * where there is no load to extrapolate — plot nothing rather than a zero.
   */
  best_e1rm: number
  best_weight: number
  best_reps: number
  workout_id: number
}

/** One local calendar day's training rollup. Days with no training are absent. */
export interface TrainingDay {
  date: string
  workouts: number
  /** seconds */
  duration: number
  /** reps x weight, in the user's own weight unit */
  volume: number
  sets: number
  exercises: number
}

/**
 * One muscle group's share of training over the window. Groups the user never
 * trained are present with zeros — the neglect signal can't be read off an
 * absent key.
 */
export interface MuscleTotal {
  muscle_group: string
  sets: number
  volume: number
  reps: number
  workouts: number
  /** Unbounded by the window (so "42 days ago" works); '' if never trained. */
  last_trained: string
}

export interface TrainingStreak {
  current: number
  longest: number
}

export interface TrainingTotals {
  workouts: number
  duration: number
  volume: number
  sets: number
  active_days: number
}

/**
 * Server-computed training aggregates. Sections the caller didn't request are
 * undefined rather than empty, so "not requested" reads differently from "no
 * data". Totals are always present.
 */
export interface TrainingStats {
  from: string
  to: string
  weight_unit: string
  totals: TrainingTotals
  daily?: TrainingDay[]
  muscles?: MuscleTotal[]
  streak?: TrainingStreak
}

export interface LoginRequest {
  email: string
  password: string
  /**
   * Opt this device into the account's configured session length instead of
   * the server's short default. Omitted is the safe reading — a shared browser
   * should get the short session unless somebody deliberately asked otherwise.
   */
  remember?: boolean
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface RegisterRequest {
  email: string
  password: string
  // Required only when the server sets REGISTRATION_INVITE_CODE.
  invite_code?: string
}
