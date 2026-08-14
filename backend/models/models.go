package models

import (
	"strings"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
)

type User struct {
	ID       int64  `json:"id" db:"id"`
	Email    string `json:"email" db:"email"`
	Name     string `json:"name" db:"name"`
	Password string `json:"-" db:"password_hash"`
	// TokenVersion is the revocation epoch; never serialized to clients.
	TokenVersion int64     `json:"-" db:"token_version"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type UserSettings struct {
	UserID            int64  `json:"user_id" db:"user_id"`
	WeightUnit        string `json:"weight_unit" db:"weight_unit"` // "lbs" or "kg"
	CalorieTarget     int    `json:"calorie_target" db:"calorie_target"`
	ProteinTarget     int    `json:"protein_target" db:"protein_target"`
	CarbTarget        int    `json:"carb_target" db:"carb_target"`
	FatTarget         int    `json:"fat_target" db:"fat_target"`
	CholesterolTarget int    `json:"cholesterol_target" db:"cholesterol_target"` // mg
	SodiumTarget      int    `json:"sodium_target" db:"sodium_target"`           // mg
	FoodAllergies     string `json:"food_allergies" db:"food_allergies"`         // free-text list, hard exclusions for the meal recommender
	FoodDislikes      string `json:"food_dislikes" db:"food_dislikes"`           // free-text list, soft avoid
	FoodLikes         string `json:"food_likes" db:"food_likes"`                 // free-text list, taste signal
	// PlanHistoryStart is the date the weight-plan progress view should start
	// from — "YYYY-MM-DD", or "" meaning "use the journey start" (the first
	// accepted goal's effective_at). Stored server-side rather than in the
	// browser so the chosen vantage point follows the user across devices.
	PlanHistoryStart string `json:"plan_history_start" db:"plan_history_start"`
	// AIHealthInsightsOptIn is explicit consent to send this user's health data
	// (blood pressure history, body metrics) to the configured third-party LLM.
	// Defaults to false and is never inferred from the operator having
	// configured a provider — consent to analyse a photo of dinner is not
	// consent to ship a blood-pressure record off the machine.
	AIHealthInsightsOptIn bool `json:"ai_health_insights_opt_in" db:"ai_health_insights_opt_in"`
	// SessionMaxDays is how long a device the user chose to remember stays
	// signed in. Clamped server-side to the operator's MAX_SESSION_DAYS on
	// every use, so a value stored before the ceiling was lowered can't
	// outlive it.
	SessionMaxDays int `json:"session_max_days" db:"session_max_days"`
	// TrackEffort is whether the session UI collects a per-set effort rating,
	// and on which scale: "" (off), "rpe" (1-10 exertion) or "rir" (reps in
	// reserve). Both scales persist to the same sets.rpe column — RIR is stored
	// as 10 - rir — so the stored number means one thing regardless of how it
	// was entered.
	TrackEffort string `json:"track_effort" db:"track_effort"`
}

// DefaultUserSettings is the single source of truth for a brand-new user's
// settings — returned when no row exists yet and used as the base a partial
// update merges onto. Must stay in sync with the user_settings column defaults.
func DefaultUserSettings(uid int64) UserSettings {
	return UserSettings{
		UserID:            uid,
		WeightUnit:        "lbs",
		CalorieTarget:     2000,
		ProteinTarget:     150,
		CarbTarget:        250,
		FatTarget:         65,
		CholesterolTarget: 300,
		SodiumTarget:      2300,
		SessionMaxDays:    config.DefaultSessionDays,
	}
}

type Exercise struct {
	ID               int64    `json:"id" db:"id"`
	Name             string   `json:"name" db:"name"`
	MuscleGroup      string   `json:"muscle_group" db:"muscle_group"`
	SecondaryMuscles []string `json:"secondary_muscles" db:"-"` // decoded from JSON column
	Category         string   `json:"category" db:"category"`   // "strength", "cardio", "flexibility"
	Equipment        string   `json:"equipment" db:"equipment"`
	Description      string   `json:"description" db:"description"`
	ImageURL         string   `json:"image_url,omitempty" db:"image_url"`
	VideoURL         string   `json:"video_url,omitempty" db:"video_url"`
	// ImageEndURL is the movement's end position. Paired with ImageURL it
	// animates the lift; alone, each is just a photo. Empty for the exercises
	// upstream only ships one frame for.
	ImageEndURL string `json:"image_url_end,omitempty" db:"image_url_end"`
	// Force ("push"/"pull"/"static"), Level ("beginner"/"intermediate"/
	// "expert") and Mechanic ("compound"/"isolation") come from the upstream
	// dataset and drive the library's filter chips.
	Force    string `json:"force,omitempty" db:"force"`
	Level    string `json:"level,omitempty" db:"level"`
	Mechanic string `json:"mechanic,omitempty" db:"mechanic"`
	// SourceID is the upstream slug, e.g. "Barbell_Bench_Press". The image
	// cache keys on it.
	SourceID string `json:"source_id,omitempty" db:"source_id"`
}

type Workout struct {
	ID        int64             `json:"id" db:"id"`
	UserID    int64             `json:"user_id" db:"user_id"`
	Name      string            `json:"name" db:"name"`
	Notes     string            `json:"notes,omitempty" db:"notes"`
	Duration  int               `json:"duration" db:"duration"` // seconds
	StartedAt time.Time         `json:"started_at" db:"started_at"`
	CreatedAt time.Time         `json:"created_at" db:"created_at"`
	ProgramID *int64            `json:"program_id,omitempty" db:"program_id"`
	Feeling   int               `json:"feeling" db:"feeling"` // 0=unrated, 1=light, 2=moderate, 3=intense
	Exercises []WorkoutExercise `json:"exercises,omitempty"`
}

type WorkoutExercise struct {
	ID          int64    `json:"id" db:"id"`
	WorkoutID   int64    `json:"workout_id" db:"workout_id"`
	ExerciseID  int64    `json:"exercise_id" db:"exercise_id"`
	OrderIndex  int      `json:"order_index" db:"order_index"`
	Notes       string   `json:"notes,omitempty" db:"notes"`
	RestSeconds int      `json:"rest_seconds" db:"rest_seconds"`
	Exercise    Exercise `json:"exercise,omitempty"`
	Sets        []Set    `json:"sets,omitempty"`
}

type Set struct {
	ID                int64   `json:"id" db:"id"`
	WorkoutExerciseID int64   `json:"workout_exercise_id" db:"workout_exercise_id"`
	SetNumber         int     `json:"set_number" db:"set_number"`
	Reps              int     `json:"reps,omitempty" db:"reps"`
	Weight            float64 `json:"weight,omitempty" db:"weight"`     // raw value in user's preferred unit (lbs or kg)
	Duration          int     `json:"duration,omitempty" db:"duration"` // seconds, for timed/cardio sets
	Distance          float64 `json:"distance,omitempty" db:"distance"` // meters, for cardio sets
	Steps             int     `json:"steps,omitempty" db:"steps"`       // step count, for cardio sets (walks/runs)
	RPE               float64 `json:"rpe,omitempty" db:"rpe"`
	IsWarmup          bool    `json:"is_warmup" db:"is_warmup"`
	Completed         bool    `json:"completed" db:"completed"`
}

type WeightLog struct {
	ID        int64     `json:"id" db:"id"`
	UserID    int64     `json:"user_id" db:"user_id"`
	Weight    float64   `json:"weight" db:"weight"` // raw value in user's preferred unit (lbs or kg)
	Notes     string    `json:"notes,omitempty" db:"notes"`
	LoggedAt  time.Time `json:"logged_at" db:"logged_at"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// Blood pressure (#bloodPressure) ------------------------------------------

// Measurement contexts. Free-form on the wire but validated to this set, so the
// capture-protocol evaluator and the AI prompt can rely on the values.
const (
	BPContextMorning     = "morning"
	BPContextEvening     = "evening"
	BPContextPostWorkout = "post_workout"
	BPContextPostMeal    = "post_meal"
	BPContextStressed    = "stressed"
	BPContextOther       = "other"
)

// BloodPressureLog is one reading. Several per day is normal and expected (see
// the migration comment) — there is no per-day upsert.
type BloodPressureLog struct {
	ID        int64  `json:"id" db:"id"`
	UserID    int64  `json:"user_id" db:"user_id"`
	Systolic  int    `json:"systolic" db:"systolic"`
	Diastolic int    `json:"diastolic" db:"diastolic"`
	Pulse     int    `json:"pulse,omitempty" db:"pulse"` // 0 = not recorded
	Context   string `json:"context,omitempty" db:"context"`
	Arm       string `json:"arm,omitempty" db:"arm"`
	Position  string `json:"position,omitempty" db:"position"`
	Rested    bool   `json:"rested" db:"rested"` // user confirmed 5 min seated rest
	Notes     string `json:"notes,omitempty" db:"notes"`
	// TZOffset is minutes east of UTC at capture time, so local-time questions
	// ("was this a morning reading?") stay answerable server-side.
	TZOffset  int       `json:"tz_offset" db:"tz_offset"`
	LoggedAt  time.Time `json:"logged_at" db:"logged_at"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`

	// Category is the ACC/AHA read on THIS reading, derived not stored. The
	// controller stamps it so no client re-implements the thresholds — and so
	// they can't drift apart between the web app, MCP, and anything later.
	Category string `json:"category" db:"-"`
}

// LogBloodPressureRequest bounds are deliberately wider than any plausible
// human reading: the point is to reject typos and unit confusion, not to
// second-guess a cuff. Systolic > diastolic is a cross-field rule validate
// can't express and is checked in the controller.
type LogBloodPressureRequest struct {
	Systolic  int       `json:"systolic" validate:"required,gte=50,lte=300"`
	Diastolic int       `json:"diastolic" validate:"required,gte=30,lte=200"`
	Pulse     int       `json:"pulse" validate:"omitempty,gte=20,lte=250"`
	Context   string    `json:"context" validate:"omitempty,oneof=morning evening post_workout post_meal stressed other"`
	Arm       string    `json:"arm" validate:"omitempty,oneof=left right"`
	Position  string    `json:"position" validate:"omitempty,oneof=seated standing lying"`
	Rested    bool      `json:"rested"`
	Notes     string    `json:"notes" validate:"omitempty,max=200"`
	TZOffset  int       `json:"tz_offset" validate:"gte=-840,lte=840"`
	LoggedAt  time.Time `json:"logged_at"`
}

// BPInsightFacts is the deterministic picture handed to the AI and stored
// alongside whatever it wrote. Persisting the facts separately means a report
// can always be shown next to the numbers it was actually based on, even after
// those numbers have moved on.
type BPInsightFacts struct {
	GeneratedAt time.Time `json:"generated_at"`

	Latest        *BloodPressureLog `json:"latest,omitempty"`
	Windows       []BPWindowFacts   `json:"windows"`
	Daily         []BPDayFacts      `json:"daily"`
	Category      string            `json:"category"`
	WorstCategory string            `json:"worst_category"`
	TrendLabel    string            `json:"trend_label"`
	SysPer30d     float64           `json:"sys_per_30d"`
	DiaPer30d     float64           `json:"dia_per_30d"`
	Nudges        []BPNudgeFacts    `json:"nudges"`

	Weight    BPWeightContext    `json:"weight"`
	Training  BPTrainingContext  `json:"training"`
	Nutrition BPNutritionContext `json:"nutrition"`
	Profile   UserProfile        `json:"profile"`
	BMI       float64            `json:"bmi"`

	// OtherMetrics is the extensibility slot: a future resting-HR or waist
	// metric appears here and flows into the model's contributing-factor
	// reasoning with no prompt or schema change.
	OtherMetrics []MetricSummary `json:"other_metrics,omitempty"`
}

// These mirror the utils.BP* analytics types. They are redeclared here rather
// than imported because models must not depend on utils — the same reason the
// vision package has its own copies of the report types.
type BPWindowFacts struct {
	Days          int     `json:"days"`
	AvgSystolic   float64 `json:"avg_systolic"`
	AvgDiastolic  float64 `json:"avg_diastolic"`
	AvgPulse      float64 `json:"avg_pulse,omitempty"`
	Category      string  `json:"category"`
	Readings      int     `json:"readings"`
	Sessions      int     `json:"sessions"`
	DaysWithData  int     `json:"days_with_data"`
	MaxSystolic   int     `json:"max_systolic"`
	MaxDiastolic  int     `json:"max_diastolic"`
	WorstCategory string  `json:"worst_category"`
	SysStdDev     float64 `json:"sys_std_dev"`
}

type BPDayFacts struct {
	Day       string  `json:"day"`
	Systolic  float64 `json:"systolic"`
	Diastolic float64 `json:"diastolic"`
	Pulse     float64 `json:"pulse,omitempty"`
	Sessions  int     `json:"sessions"`
	Readings  int     `json:"readings"`
	Category  string  `json:"category"`
	Morning   bool    `json:"morning"`
	Evening   bool    `json:"evening"`
}

type BPNudgeFacts struct {
	Key      string `json:"key"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Severity string `json:"severity"`
}

type BPWeightContext struct {
	CurrentLbs   float64 `json:"current_lbs"`
	Change30dLbs float64 `json:"change_30d_lbs"`
	Change90dLbs float64 `json:"change_90d_lbs"`
	BMICategory  string  `json:"bmi_category"`
	Entries      int     `json:"entries"`
}

type BPTrainingContext struct {
	WorkoutDays30 int `json:"workout_days_30"`
	WorkoutDays90 int `json:"workout_days_90"`
}

type BPNutritionContext struct {
	AvgSodiumMg    float64 `json:"avg_sodium_mg"`
	SodiumTargetMg int     `json:"sodium_target_mg"`
	DaysLogged30   int     `json:"days_logged_30"`
}

// BPContributor / BPActionStep / BPInsightReport mirror the vision package's
// shapes; compile-time assertions in controllers/bp_insight.go keep them in
// step, so a field added on one side fails the build rather than silently
// dropping out of the stored report.
type BPContributor struct {
	Factor    string `json:"factor"`
	Direction string `json:"direction"`
	Evidence  string `json:"evidence"`
	Strength  string `json:"strength"`
}

type BPActionStep struct {
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	WhyItWorks string `json:"why_it_works"`
	Effort     string `json:"effort"`
	Horizon    string `json:"horizon"`
}

type BPInsightReport struct {
	Headline        string          `json:"headline"`
	WhereYouStand   string          `json:"where_you_stand"`
	TrendReading    string          `json:"trend_reading"`
	Contributors    []BPContributor `json:"contributors"`
	ActionPlan      []BPActionStep  `json:"action_plan"`
	MeasurementTips []CheckinPoint  `json:"measurement_tips"`
	SeeADoctor      string          `json:"see_a_doctor"`
	Outlook         string          `json:"outlook"`
}

// BPInsight is one stored run. Facts are always present; Report is nil when no
// AI provider was configured or the call failed — the page renders every fact
// either way.
type BPInsight struct {
	ID         int64     `json:"id" db:"id"`
	UserID     int64     `json:"user_id" db:"user_id"`
	FactsJSON  string    `json:"-" db:"facts"`
	ReportJSON string    `json:"-" db:"report"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`

	Facts  *BPInsightFacts  `json:"facts" db:"-"`
	Report *BPInsightReport `json:"report" db:"-"`
}

// MetricSummary is the uniform card-level readout of any tracked health metric.
// Every metric store returns one, so the health hub and the BP insight's
// context can both take a new metric without layout or prompt changes.
type MetricSummary struct {
	Key           string    `json:"key"` // "weight" | "blood_pressure" | ...
	Label         string    `json:"label"`
	Value         string    `json:"value"` // preformatted: "128/82", "184.2"
	Unit          string    `json:"unit"`
	Category      string    `json:"category"` // "" when the metric has no categories
	Tone          string    `json:"tone"`     // "good" | "watch" | "bad" | "neutral"
	Change        float64   `json:"change"`
	ChangeDays    int       `json:"change_window_days"`
	LowerIsBetter bool      `json:"lower_is_better"`
	LastLoggedAt  time.Time `json:"last_logged_at"`
	Readings      int       `json:"readings"`
}

type FoodLog struct {
	ID          int64   `json:"id" db:"id"`
	UserID      int64   `json:"user_id" db:"user_id"`
	Name        string  `json:"name" db:"name"`
	Brand       string  `json:"brand,omitempty" db:"brand"`
	Meal        string  `json:"meal" db:"meal"` // "breakfast", "lunch", "dinner", "snacks"
	Calories    float64 `json:"calories" db:"calories"`
	Protein     float64 `json:"protein" db:"protein"`
	Carbs       float64 `json:"carbs" db:"carbs"`
	Fat         float64 `json:"fat" db:"fat"`
	Fiber       float64 `json:"fiber" db:"fiber"`
	Sugar       float64 `json:"sugar" db:"sugar"`
	Sodium      float64 `json:"sodium" db:"sodium"`
	Cholesterol float64 `json:"cholesterol" db:"cholesterol"`
	Servings    float64 `json:"servings" db:"servings"`
	ServingSize string  `json:"serving_size" db:"serving_size"`
	// ServingSizeGrams is the mass of one serving, so re-opening this entry can
	// restore the amount/unit picker instead of falling back to a bare
	// multiplier. 0 means unknown or not mass-based.
	ServingSizeGrams float64 `json:"serving_size_grams" db:"serving_size_grams"`
	// ServingSizeML is the same for volume, and is how a liquid logged by the
	// cup or fluid ounce reopens on that unit. Foods normally carry one basis or
	// the other; both are set only when the source stated both. 0 = unknown.
	ServingSizeML float64   `json:"serving_size_ml" db:"serving_size_ml"`
	Barcode       string    `json:"barcode,omitempty" db:"barcode"`
	ImageURL      string    `json:"image_url,omitempty" db:"image_url"`
	Source        string    `json:"source,omitempty" db:"source"` // "off" | "fdc" | "saved" | "manual" | "photo" | "ai"
	LoggedAt      time.Time `json:"logged_at" db:"logged_at"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// RecentFood is a food the user logs often: the most-recent logged entry for a
// distinct food, plus how many times it was logged within the lookback window.
// Powers the Log Food "Recent" tab (frequently-used items, not just today).
type RecentFood struct {
	FoodLog
	LogCount int `json:"log_count"`
}

type SavedFood struct {
	ID               int64     `json:"id" db:"id"`
	UserID           int64     `json:"user_id,omitempty" db:"user_id"`
	Name             string    `json:"name" db:"name"`
	Brand            string    `json:"brand" db:"brand"`
	Calories         float64   `json:"calories" db:"calories"`
	Protein          float64   `json:"protein" db:"protein"`
	Carbs            float64   `json:"carbs" db:"carbs"`
	Fat              float64   `json:"fat" db:"fat"`
	Fiber            float64   `json:"fiber" db:"fiber"`
	Sugar            float64   `json:"sugar" db:"sugar"`
	Sodium           float64   `json:"sodium" db:"sodium"`
	Cholesterol      float64   `json:"cholesterol" db:"cholesterol"`
	ServingSize      string    `json:"serving_size" db:"serving_size"`
	ServingSizeGrams float64   `json:"serving_size_grams" db:"serving_size_grams"`
	ServingSizeML    float64   `json:"serving_size_ml" db:"serving_size_ml"`
	Barcode          string    `json:"barcode,omitempty" db:"barcode"`
	ImageURL         string    `json:"image_url,omitempty" db:"image_url"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
}

// FoodPortion is a household measure a source publishes for a food, together
// with its exact mass — e.g. {"1 tbsp", 13.8}. Only sources that report gram
// weights (USDA FDC, and OFF serving_size strings we can parse) contribute
// these: a volume-to-mass conversion is density-dependent, so we surface one
// only when the data provider stated it rather than guessing.
type FoodPortion struct {
	Label string  `json:"label"`
	Grams float64 `json:"grams"`
	// ML is the volume the label names, when it names one — the 15 in
	// "1 tbsp". A portion carrying both is this food's published density, which
	// is what lets the client offer cups and spoons as exact units for it
	// instead of falling back to an assumed 1 g/ml.
	ML float64 `json:"ml,omitempty"`
}

type FoodSearchResult struct {
	Name        string  `json:"name"`
	Brand       string  `json:"brand,omitempty"`
	Calories    float64 `json:"calories"`
	Protein     float64 `json:"protein"`
	Carbs       float64 `json:"carbs"`
	Fat         float64 `json:"fat"`
	Fiber       float64 `json:"fiber"`
	Sugar       float64 `json:"sugar"`
	Sodium      float64 `json:"sodium"`
	Cholesterol float64 `json:"cholesterol"`
	ServingSize string  `json:"serving_size"`
	// ServingSizeGrams is the mass the quoted nutrition numbers represent, so
	// the client can rescale to any amount exactly. 0 = unknown/not mass-based.
	ServingSizeGrams float64 `json:"serving_size_grams,omitempty"`
	// ServingSizeML is the volume those same numbers represent, for foods
	// measured by volume rather than mass. 0 = unknown/not volume-based.
	ServingSizeML float64       `json:"serving_size_ml,omitempty"`
	Portions      []FoodPortion `json:"portions,omitempty"`
	ImageURL      string        `json:"image_url,omitempty"`
	Source        string        `json:"source"` // "off" | "fdc" | "saved" | "manual" | "photo"

	// LabelAccurate marks a result whose numbers came off a real Nutrition
	// Facts panel — USDA Branded labelNutrients, or an Open Food Facts record
	// that published per-serving values — rather than a per-100g figure the
	// user has to rescale, or an AI estimate. It is the difference between
	// "this is what the box says" and "this is roughly right", and the client
	// surfaces it so the two are never mistaken for each other.
	LabelAccurate bool `json:"label_accurate,omitempty"`
	// Barcode is the GTIN this result was resolved from, when it came from a
	// scan, so the client can persist it on the log entry.
	Barcode string `json:"barcode,omitempty"`
	// LabelDate is FDC's publicationDate — informational only. Branded records
	// are manufacturer submissions and can lag a reformulation by years, so
	// the age of the data is worth showing rather than hiding.
	LabelDate string `json:"label_date,omitempty"`
}

type FoodHistoryPoint struct {
	Date     string  `json:"date"`
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Carbs    float64 `json:"carbs"`
	Fat      float64 `json:"fat"`
	// Sodium (mg) is carried here for the blood-pressure insight: it is the
	// strongest dietary lever on blood pressure the app already records.
	Sodium float64 `json:"sodium"`
}

// Request/Response types

type RegisterRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8,max=72"`
	// InviteCode is required only when the server sets
	// REGISTRATION_INVITE_CODE; ignored otherwise.
	InviteCode string `json:"invite_code"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" validate:"required"`
	// max=72 because bcrypt silently truncates there — without the cap a user
	// picking a longer passphrase gets less security than they think.
	NewPassword string `json:"new_password" validate:"required,min=8,max=72"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
	// Remember opts this device into the user's configured session length
	// instead of the short default. Absent (false) is the safe reading for any
	// client that doesn't know about the flag — a shared browser gets the
	// short session unless somebody deliberately asked otherwise.
	Remember bool `json:"remember"`
}

// Passkey is one enrolled WebAuthn credential as the account screen shows it —
// metadata only, never the credential blob or public key.
type Passkey struct {
	ID         int64      `json:"id"`
	Name       string     `json:"name"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
}

// CreatePasskeyRequest names a passkey at enrolment, so a user with several can
// tell them apart ("iPhone", "YubiKey").
type CreatePasskeyRequest struct {
	Name string `json:"name" validate:"max=100"`
}

// DeviceSession is one signed-in device as the account screen shows it. There
// is no token material here — the session id is a revocation handle, not a
// credential, and knowing it grants nothing.
type DeviceSession struct {
	ID         string    `json:"id"`
	Label      string    `json:"label"`
	UserAgent  string    `json:"user_agent"`
	Remembered bool      `json:"remembered"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	// Current marks the session making the request, so the UI can label it and
	// warn before signing itself out.
	Current bool `json:"current"`
}

type AuthResponse struct {
	Token        string `json:"token"`
	RefreshToken string `json:"refresh_token"`
	User         User   `json:"user"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

// UpdateUserRequest is the editable account profile — currently just the
// display name. Empty is allowed (clears the name, falling back to the email).
type UpdateUserRequest struct {
	Name string `json:"name" validate:"max=100"`
}

// PersonalAccessToken is what list/create responses expose — metadata only,
// never the hash or plaintext value.
type PersonalAccessToken struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	TokenPrefix string     `json:"token_prefix"`
	CreatedAt   time.Time  `json:"created_at"`
	LastUsedAt  *time.Time `json:"last_used_at"`
	ExpiresAt   *time.Time `json:"expires_at"`
}

type CreateTokenRequest struct {
	Name string `json:"name" validate:"required,min=1,max=100"`
	// ExpiresInDays is nil for a token that never expires.
	ExpiresInDays *int `json:"expires_in_days"`
}

// CreateTokenResponse is the only response in the system that ever carries a
// plaintext secret — shown to the caller exactly once, at creation.
type CreateTokenResponse struct {
	Token PersonalAccessToken `json:"token"`
	Value string              `json:"value"`
}

type CreateWorkoutRequest struct {
	Name      string                     `json:"name" validate:"required"`
	Notes     string                     `json:"notes"`
	Duration  int                        `json:"duration"`
	StartedAt time.Time                  `json:"started_at"`
	ProgramID *int64                     `json:"program_id"`
	Feeling   int                        `json:"feeling" validate:"gte=0,lte=3"`
	Exercises []CreateWorkoutExerciseReq `json:"exercises"`
}

type CreateWorkoutExerciseReq struct {
	ExerciseID  int64          `json:"exercise_id" validate:"required"`
	OrderIndex  int            `json:"order_index"`
	Notes       string         `json:"notes"`
	RestSeconds int            `json:"rest_seconds"`
	Sets        []CreateSetReq `json:"sets"`
}

type CreateSetReq struct {
	SetNumber int     `json:"set_number"`
	Reps      int     `json:"reps"`
	Weight    float64 `json:"weight"`
	Duration  int     `json:"duration"`
	Distance  float64 `json:"distance"`
	Steps     int     `json:"steps"`
	RPE       float64 `json:"rpe"`
	IsWarmup  bool    `json:"is_warmup"`
	// Pointer so "omitted" (older clients, manual add/edit forms) is
	// distinguishable from an explicit false — nil defaults to true.
	Completed *bool `json:"completed,omitempty"`
}

type LogWeightRequest struct {
	Weight   float64   `json:"weight" validate:"required,gt=0,lte=2000"`
	Notes    string    `json:"notes"`
	LoggedAt time.Time `json:"logged_at"`
}

// UserProfile carries the demographic facts (birth date/sex/height/activity
// level) used for BMI, healthy-weight-range, and AI weight-loss-plan
// generation. Sex is a BMR-formula input only, not a gender-identity field.
// One row per user, like UserSettings. BirthDate is stored (and computed
// against "now") rather than a static age, so age stays correct over time —
// see utils.AgeFromBirthDate.
type UserProfile struct {
	UserID        int64   `json:"user_id" db:"user_id"`
	BirthDate     string  `json:"birth_date" db:"birth_date"` // "YYYY-MM-DD", "" if unset
	Sex           string  `json:"sex" db:"sex"`               // "male" | "female"
	HeightInches  float64 `json:"height_inches" db:"height_inches"`
	ActivityLevel string  `json:"activity_level" db:"activity_level"` // "sedentary"|"light"|"moderate"|"active"|"very_active"
}

// DefaultUserProfile is the zero-value fallback returned when no profile row
// exists yet, mirroring DefaultUserSettings.
func DefaultUserProfile(uid int64) UserProfile {
	return UserProfile{UserID: uid, ActivityLevel: "moderate"}
}

// UpsertProfileRequest is a PATCH: every field is a pointer so a nil (absent)
// field is COALESCEd over the existing/default value rather than zeroing it.
// The frontend must omit rather than send a zero/empty value for a field the
// user hasn't set — go-playground/validator's `omitempty` only treats a nil
// pointer as absent, not a non-nil pointer to a zero value, so e.g. a
// non-nil pointer to "" still fails `oneof`.
type UpsertProfileRequest struct {
	BirthDate     *string  `json:"birth_date" validate:"omitempty,datetime=2006-01-02"`
	Sex           *string  `json:"sex" validate:"omitempty,oneof=male female"`
	HeightInches  *float64 `json:"height_inches" validate:"omitempty,gt=0,lte=120"`
	ActivityLevel *string  `json:"activity_level" validate:"omitempty,oneof=sedentary light moderate active very_active"`
}

// BMIResult is the deterministic (non-AI) BMI + healthy-weight-range readout,
// computed server-side so both the profile endpoint and plan generation share
// one source of truth.
type BMIResult struct {
	BMI              float64            `json:"bmi"`
	Category         string             `json:"category"`
	HealthyRangeLow  float64            `json:"healthy_range_low"`  // lbs
	HealthyRangeHigh float64            `json:"healthy_range_high"` // lbs
	ObeseMinLbs      float64            `json:"obese_min_lbs"`      // lbs; weight at BMI 30, start of the obese zone
	LossGuidance     WeeklyLossGuidance `json:"loss_guidance"`
}

// WeeklyLossGuidance is the deterministic, BMI-category-based safe pace of
// weight loss (lbs/week bounds for the sustainable phase, after the initial
// water-weight drop) plus a plain-language note — see
// utils.WeeklyLossGuidanceFor, which populates this.
type WeeklyLossGuidance struct {
	LowLbsPerWeek  float64 `json:"low_lbs_per_week"`
	HighLbsPerWeek float64 `json:"high_lbs_per_week"`
	Note           string  `json:"note"`
}

// ActivityEnergyLevel is one row of the "what would I need to eat at this
// activity level" table shown alongside a generated plan. Every level is
// reported, not just the user's own, so they can see what training more or
// less would do to their intake before committing to targets.
type ActivityEnergyLevel struct {
	Key         string  `json:"key"` // matches UserProfile.ActivityLevel
	Label       string  `json:"label"`
	Description string  `json:"description"`
	Multiplier  float64 `json:"multiplier"`
	// MaintenanceCalories is BMR * Multiplier: intake that holds weight steady.
	MaintenanceCalories int `json:"maintenance_calories"`
	// IntakeLow/HighCalories bound the intake that produces the safe pace band
	// (WeeklyLossGuidance) at this level — low intake = faster end of the band.
	IntakeLowCalories  int `json:"intake_low_calories"`
	IntakeHighCalories int `json:"intake_high_calories"`
	// FloorLimited marks a level where the safe pace would require eating
	// below the minimum this app recommends, so the range was raised to the
	// floor — i.e. that pace isn't reachable by diet alone at this level.
	FloorLimited bool `json:"floor_limited"`
	// PlanDeficitCalories/PlanLbsPerWeek are what the plan's own calorie
	// target works out to if the user actually trains at this level. Zero when
	// the basis was built without a calorie target.
	PlanDeficitCalories int     `json:"plan_deficit_calories"`
	PlanLbsPerWeek      float64 `json:"plan_lbs_per_week"`
	IsProfileLevel      bool    `json:"is_profile_level"`
}

// MacroRange is a recommended band for one macronutrient, expressed both in
// grams and as the per-pound figure it was derived from so the user can see
// the reasoning rather than just the number.
type MacroRange struct {
	LowGrams  int     `json:"low_grams"`
	HighGrams int     `json:"high_grams"`
	PerLbLow  float64 `json:"per_lb_low"`
	PerLbHigh float64 `json:"per_lb_high"`
	Basis     string  `json:"basis"` // what the per-pound figures multiply, e.g. "goal weight"
	Rationale string  `json:"rationale"`
	// FloorGrams is the point below which cutting this macro starts costing
	// something real (lean mass for protein, hormone function for fat) — the
	// client flags a reduced-adherence scenario that lands under it.
	FloorGrams int `json:"floor_grams"`
}

// PlanEnergyBasis is the deterministic, non-AI energy picture behind a weight
// plan: who the plan was computed for, what their body burns, what intake
// each activity level implies, and the macro bands a sensible plan sits in.
// Built by utils.BuildPlanEnergyBasis and returned alongside a generated
// draft so the user can judge the AI's numbers against the arithmetic instead
// of taking them on faith.
type PlanEnergyBasis struct {
	// The profile recount: everything the numbers below were derived from.
	Sex              string  `json:"sex"`
	Age              int     `json:"age"`
	HeightInches     float64 `json:"height_inches"`
	CurrentWeightLbs float64 `json:"current_weight_lbs"`
	TargetWeightLbs  float64 `json:"target_weight_lbs"`
	WeightToLoseLbs  float64 `json:"weight_to_lose_lbs"`
	BMI              float64 `json:"bmi"`
	BMICategory      string  `json:"bmi_category"`
	ActivityLevel    string  `json:"activity_level"`

	BMR          int `json:"bmr"`           // resting burn, Mifflin-St Jeor
	CalorieFloor int `json:"calorie_floor"` // lowest intake this app will recommend

	Levels []ActivityEnergyLevel `json:"levels"`

	// The profile activity level's row, lifted out for the headline readout.
	MaintenanceCalories int     `json:"maintenance_calories"`
	CalorieTarget       int     `json:"calorie_target"` // the plan's proposed intake, 0 if none
	PlanDeficitCalories int     `json:"plan_deficit_calories"`
	PlanLbsPerWeek      float64 `json:"plan_lbs_per_week"`

	Guidance WeeklyLossGuidance `json:"guidance"`
	Protein  MacroRange         `json:"protein"`
	Fat      MacroRange         `json:"fat"`
}

// NutritionGoal is one append-only row in the nutrition-goal history: never
// UPDATEd once inserted. The "current" goal is the latest row by EffectiveAt.
// Accepting a plan also writes these four targets into UserSettings so the
// rest of the app (food logging, meal recommender) keeps reading from a
// single current-settings row.
type NutritionGoal struct {
	ID            int64     `json:"id" db:"id"`
	UserID        int64     `json:"user_id" db:"user_id"`
	CalorieTarget int       `json:"calorie_target" db:"calorie_target"`
	ProteinTarget int       `json:"protein_target" db:"protein_target"`
	CarbTarget    int       `json:"carb_target" db:"carb_target"`
	FatTarget     int       `json:"fat_target" db:"fat_target"`
	TargetWeight  float64   `json:"target_weight" db:"target_weight"` // lbs, canonical unit like weight_logs
	Source        string    `json:"source" db:"source"`               // "ai" (no manual entry path in v1)
	Notes         string    `json:"notes" db:"notes"`                 // flattened plain-text rationale/safety caveats
	EffectiveAt   time.Time `json:"effective_at" db:"effective_at"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	// PlanDetailJSON is the stored JSON encoding of Detail. It's carried as a
	// raw string at the store boundary (stores stay transport-agnostic) and
	// decoded into Detail by the controller. Goals accepted before structured
	// plan text existed have "" here and only Notes to show.
	PlanDetailJSON string      `json:"-" db:"plan_detail"`
	Detail         *PlanDetail `json:"detail,omitempty" db:"-"`
}

// PlanSection is one headed group of bullets in a structured plan write-up.
// The AI returns these instead of one prose blob so the UI can render real
// headings and lists without a markdown parser.
type PlanSection struct {
	Heading string   `json:"heading"`
	Bullets []string `json:"bullets"`
}

// PlanDetail is the structured, renderable form of an AI plan's explanation:
// a one-line summary plus headed bullet sections.
type PlanDetail struct {
	Summary  string        `json:"summary"`
	Sections []PlanSection `json:"sections"`
}

// FlattenNotes renders a PlanDetail down to a single plain-text string for
// the legacy NutritionGoal.Notes column, so anything reading Notes (older
// clients, the goal-history list) still shows something sensible.
func (d *PlanDetail) FlattenNotes() string {
	if d == nil {
		return ""
	}
	parts := []string{}
	if d.Summary != "" {
		parts = append(parts, d.Summary)
	}
	for _, s := range d.Sections {
		if s.Heading != "" {
			parts = append(parts, s.Heading+": "+strings.Join(s.Bullets, "; "))
		} else if len(s.Bullets) > 0 {
			parts = append(parts, strings.Join(s.Bullets, "; "))
		}
	}
	return strings.Join(parts, " ")
}

// WeightPlanProjectionPoint is one week of the AI-projected weight trajectory
// tied to the NutritionGoal that produced it.
type WeightPlanProjectionPoint struct {
	ID              int64     `json:"id" db:"id"`
	NutritionGoalID int64     `json:"nutrition_goal_id" db:"nutrition_goal_id"`
	Week            int       `json:"week" db:"week"` // 0 = plan start
	ExpectedWeight  float64   `json:"expected_weight" db:"expected_weight"`
	ExpectedDate    time.Time `json:"expected_date" db:"expected_date"`
}

// MotivationNote is a weekly-cached AI-authored encouragement message, keyed
// by the Monday that starts its coverage week — at most one AI call per user
// per week, regardless of how many times the adherence panel is viewed.
type MotivationNote struct {
	ID        int64     `json:"id" db:"id"`
	UserID    int64     `json:"user_id" db:"user_id"`
	WeekStart time.Time `json:"week_start" db:"week_start"`
	Message   string    `json:"message" db:"message"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// --- Progress check-in (#planCheckin) ---------------------------------------
//
// The adherence endpoint answers "am I on the plan's line right now?" over a
// 7-day window. The check-in is the other question: how is the whole journey
// going, how do the last few weeks compare to it, and what should change. It
// is user-triggered (not computed on every dashboard load) because it costs an
// AI call, and each run is persisted so a report is stable once read.

// CheckinWindow is one rolling-window slice of logging/training consistency.
// The check-in reports several (7/28/90 days) side by side — that contrast is
// what separates "always been loose about logging" from "stopped logging three
// weeks ago", which need completely different advice.
type CheckinWindow struct {
	Days           int     `json:"days"`
	FoodLoggedDays int     `json:"food_logged_days"`
	WorkoutDays    int     `json:"workout_days"`
	AvgCalories    float64 `json:"avg_calories"` // mean over days with any food logged
	AvgProtein     float64 `json:"avg_protein"`
	CalorieTarget  int     `json:"calorie_target"`
	ProteinTarget  int     `json:"protein_target"`
}

// Check-in trend patterns. Derived deterministically from the overall vs.
// recent regression slopes (see controllers.classifyPattern) so the verdict,
// the headline accent, and the empty-AI fallback all exist without a provider.
const (
	CheckinPatternAhead        = "ahead"        // beating the plan's pace
	CheckinPatternSteady       = "steady"       // recent pace ≈ overall pace ≈ plan
	CheckinPatternAccelerating = "accelerating" // recent pace meaningfully faster
	CheckinPatternSlowing      = "slowing"      // still losing, but notably slower
	CheckinPatternStalled      = "stalled"      // recent pace ≈ 0
	CheckinPatternRegaining    = "regaining"    // recent trend is upward
)

// CheckinFacts is everything the check-in report is grounded in, computed
// server-side from existing stores. It is persisted alongside the report so a
// stored check-in can be re-rendered (and audited against) without recomputing
// anything — and so the page still has a full readout when no AI provider is
// configured.
type CheckinFacts struct {
	GeneratedAt   time.Time `json:"generated_at"`
	WeeksIntoPlan int       `json:"weeks_into_plan"`
	PlanStart     time.Time `json:"plan_start"`
	PlanEnd       time.Time `json:"plan_end"`
	JourneyStart  time.Time `json:"journey_start"` // first-ever accepted plan

	StartWeight       float64 `json:"start_weight"`
	CurrentWeight     float64 `json:"current_weight"`
	TargetWeight      float64 `json:"target_weight"`
	ExpectedWeightNow float64 `json:"expected_weight_now"`
	VarianceLbs       float64 `json:"variance_lbs"` // magnitude; BehindPlan carries the sign's meaning
	BehindPlan        bool    `json:"behind_plan"`
	LostLbs           float64 `json:"lost_lbs"`
	PctBodyWeightLost float64 `json:"pct_body_weight_lost"`

	// The overall-vs-recent split this whole feature exists for. Both are OLS
	// slopes over daily weights (see utils.PaceLbsPerWeek), reported as
	// lbs/week LOST — positive means losing, negative means gaining, for both
	// loss and gain plans, so the sign always means the same thing.
	//
	// Overall spans the whole weigh-in record rather than only the current
	// plan's span: a plan accepted today has no overall pace otherwise, and
	// pre-plan weigh-ins are still this person's real trend. Progress against
	// the plan specifically is carried by VarianceLbs/BehindPlan.
	OverallLbsPerWeek float64 `json:"overall_lbs_per_week"`
	RecentLbsPerWeek  float64 `json:"recent_lbs_per_week"`
	RecentWindowDays  int     `json:"recent_window_days"`
	PlanLbsPerWeek    float64 `json:"plan_lbs_per_week"`
	Pattern           string  `json:"pattern"`

	// Where the user's own trend (not the plan) says they land.
	ProjectedGoalDate  time.Time `json:"projected_goal_date"`    // zero when the trend never reaches the goal
	DaysVsPlanGoalDate int       `json:"days_vs_plan_goal_date"` // + = later than plan, - = earlier

	Adherence      []CheckinWindow         `json:"adherence"`
	WeeklyVariance []WeightPlanHistoryWeek `json:"weekly_variance"`

	Basis   *PlanEnergyBasis `json:"basis,omitempty"` // nil on an incomplete profile
	BMI     BMIResult        `json:"bmi"`
	Profile UserProfile      `json:"profile"`
}

// CheckinBenchmark is one "how does this compare to people in the same
// situation" row. The values are supplied by the AI provider, not computed —
// see the progress-checkin prompt, which requires ranges over false precision.
type CheckinBenchmark struct {
	Label        string `json:"label"`
	UserValue    string `json:"user_value"`
	TypicalRange string `json:"typical_range"`
	Verdict      string `json:"verdict"` // "ahead" | "typical" | "behind"
	Context      string `json:"context"`
}

// CheckinPoint is a titled observation — used for both "what's working" and
// "what's slipping" so the client renders them with one component.
type CheckinPoint struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// CheckinRecommendation is one concrete change to make, with the reason it
// tends to work attached — the "why" is what makes this coaching rather than
// a to-do list.
type CheckinRecommendation struct {
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	WhyItWorks string `json:"why_it_works"`
	Effort     string `json:"effort"` // "easy" | "moderate" | "hard"
}

// CheckinReport is the AI-authored narrative layered over CheckinFacts. The
// overall and recent assessments are separate fields (not one blob) because
// the case worth catching — on plan overall, stalled for three weeks — is
// invisible unless the two are stated independently.
type CheckinReport struct {
	Headline           string                  `json:"headline"`
	OverallAssessment  string                  `json:"overall_assessment"`
	RecentAssessment   string                  `json:"recent_assessment"`
	Benchmarks         []CheckinBenchmark      `json:"benchmarks"`
	WhatsWorking       []CheckinPoint          `json:"whats_working"`
	WhatsSlipping      []CheckinPoint          `json:"whats_slipping"`
	Recommendations    []CheckinRecommendation `json:"recommendations"`
	WhatWorksGenerally []CheckinPoint          `json:"what_works_generally"`
	Outlook            string                  `json:"outlook"`
}

// PlanCheckin is one persisted run. FactsJSON/ReportJSON are the raw stored
// columns (stores stay transport-agnostic); the controller decodes them into
// Facts/Report for the response. Report is nil when the run happened with no
// AI provider configured — the client still renders every fact.
type PlanCheckin struct {
	ID         int64     `json:"id" db:"id"`
	UserID     int64     `json:"user_id" db:"user_id"`
	GoalID     int64     `json:"goal_id" db:"goal_id"`
	FactsJSON  string    `json:"-" db:"facts"`
	ReportJSON string    `json:"-" db:"report"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`

	Facts  *CheckinFacts  `json:"facts" db:"-"`
	Report *CheckinReport `json:"report" db:"-"`
}

// GenerateWeightPlanRequest is what the user submits to kick off AI plan
// generation: just the target weight (and optional timeframe preference) —
// everything else the model needs is assembled server-side from the profile,
// latest weight, and settings.
type GenerateWeightPlanRequest struct {
	TargetWeight   float64 `json:"target_weight" validate:"required,gt=0,lte=2000"`
	TimeframeWeeks int     `json:"timeframe_weeks" validate:"omitempty,gte=1,lte=104"`
}

// DraftWeightPlanWeek is one week of the AI-projected trajectory returned in
// a draft plan (pre-acceptance).
type DraftWeightPlanWeek struct {
	Week           int     `json:"week"`
	ExpectedWeight float64 `json:"expected_weight"`
}

// AcceptWeightPlanRequest persists a (possibly user-edited) draft plan: the
// frontend echoes back the reviewed draft plus the target weight it was
// generated for.
type AcceptWeightPlanRequest struct {
	CalorieTarget    int                   `json:"calorie_target" validate:"required,gte=800,lte=6000"`
	ProteinTarget    int                   `json:"protein_target" validate:"required,gte=0"`
	CarbTarget       int                   `json:"carb_target" validate:"required,gte=0"`
	FatTarget        int                   `json:"fat_target" validate:"required,gte=0"`
	TargetWeight     float64               `json:"target_weight" validate:"required,gt=0,lte=2000"`
	Notes            string                `json:"notes"`
	WeeklyTrajectory []DraftWeightPlanWeek `json:"weekly_trajectory" validate:"required,min=1,dive"`
	// PlanDetail is the structured write-up the user reviewed. Optional: a
	// provider that returned only prose, or an older client, sends just Notes.
	PlanDetail *PlanDetail `json:"plan_detail"`
}

// WeightPlanHistoryWeek is one weekly bucket of the locked-in progress
// record: what the plan in force that week said the user should weigh versus
// what they actually weighed. Both sides are derived — the target from the
// weight_plan_projections frozen when that plan was accepted, the actual from
// weight_logs — so regenerating a plan can never rewrite an elapsed week.
type WeightPlanHistoryWeek struct {
	WeekStart    string  `json:"week_start"` // "YYYY-MM-DD"
	Week         int     `json:"week"`       // index from the history start date
	TargetWeight float64 `json:"target_weight"`
	ActualWeight float64 `json:"actual_weight"` // 0 when no log falls in this week
	HasActual    bool    `json:"has_actual"`
	GoalID       int64   `json:"goal_id"`      // the plan in force that week; 0 if none
	VarianceLbs  float64 `json:"variance_lbs"` // actual - target; positive = heavier than planned
}

// WeightPlanSegment summarises one accepted plan's stretch of the history:
// the pace it promised against the pace actually achieved while it was in
// force. This is the "0.5 lbs/wk actual vs 1.0 lbs/wk target" readout.
type WeightPlanSegment struct {
	GoalID           int64   `json:"goal_id"`
	From             string  `json:"from"` // "YYYY-MM-DD"
	To               string  `json:"to"`
	Weeks            float64 `json:"weeks"`
	StartWeight      float64 `json:"start_weight"`
	EndWeight        float64 `json:"end_weight"`
	TargetLbsPerWeek float64 `json:"target_lbs_per_week"`
	ActualLbsPerWeek float64 `json:"actual_lbs_per_week"`
	IsCurrent        bool    `json:"is_current"`
}

// WeightPlanHistory is the full locked progress record returned by
// GET /weight/plan/history.
type WeightPlanHistory struct {
	JourneyStart string                  `json:"journey_start"` // first accepted plan's date, "" if none
	From         string                  `json:"from"`          // the window actually used
	Weeks        []WeightPlanHistoryWeek `json:"weeks"`
	Segments     []WeightPlanSegment     `json:"segments"`
}

type LogFoodRequest struct {
	Name             string    `json:"name" validate:"required"`
	Brand            string    `json:"brand"`
	Meal             string    `json:"meal" validate:"required,oneof=breakfast lunch dinner snacks"`
	Calories         float64   `json:"calories" validate:"gte=0"`
	Protein          float64   `json:"protein" validate:"gte=0"`
	Carbs            float64   `json:"carbs" validate:"gte=0"`
	Fat              float64   `json:"fat" validate:"gte=0"`
	Fiber            float64   `json:"fiber" validate:"gte=0"`
	Sugar            float64   `json:"sugar" validate:"gte=0"`
	Sodium           float64   `json:"sodium" validate:"gte=0"`
	Cholesterol      float64   `json:"cholesterol" validate:"gte=0"`
	Servings         float64   `json:"servings" validate:"gte=0"`
	ServingSize      string    `json:"serving_size"`
	ServingSizeGrams float64   `json:"serving_size_grams" validate:"gte=0"`
	ServingSizeML    float64   `json:"serving_size_ml" validate:"gte=0"`
	Barcode          string    `json:"barcode"`
	ImageURL         string    `json:"image_url"`
	Source           string    `json:"source" validate:"omitempty,oneof=off fdc manual photo saved ai"`
	LoggedAt         time.Time `json:"logged_at"`
}

type AnalyzeLabelRequest struct {
	ImageBase64 string `json:"image_base64" validate:"required"`
	MediaType   string `json:"media_type" validate:"required,oneof=image/jpeg image/png image/webp"`
}

type ParseMealRequest struct {
	Description string `json:"description" validate:"required,max=1000"`
}

type AnalyzeMealPhotoRequest struct {
	ImageBase64 string `json:"image_base64" validate:"required"`
	MediaType   string `json:"media_type" validate:"required,oneof=image/jpeg image/png image/webp"`
	Description string `json:"description" validate:"omitempty,max=1000"`
}

type RecommendMealsRequest struct {
	Meal string `json:"meal" validate:"required,oneof=breakfast lunch dinner snacks"`
	Date string `json:"date" validate:"required,datetime=2006-01-02"`
}

type SaveFoodRequest struct {
	Name             string  `json:"name" validate:"required"`
	Brand            string  `json:"brand"`
	Calories         float64 `json:"calories" validate:"gte=0"`
	Protein          float64 `json:"protein" validate:"gte=0"`
	Carbs            float64 `json:"carbs" validate:"gte=0"`
	Fat              float64 `json:"fat" validate:"gte=0"`
	Fiber            float64 `json:"fiber" validate:"gte=0"`
	Sugar            float64 `json:"sugar" validate:"gte=0"`
	Sodium           float64 `json:"sodium" validate:"gte=0"`
	Cholesterol      float64 `json:"cholesterol" validate:"gte=0"`
	ServingSize      string  `json:"serving_size"`
	ServingSizeGrams float64 `json:"serving_size_grams" validate:"gte=0"`
	ServingSizeML    float64 `json:"serving_size_ml" validate:"gte=0"`
	Barcode          string  `json:"barcode"`
	ImageURL         string  `json:"image_url"`
}

type UpdateSavedFoodRequest struct {
	Name             string  `json:"name" validate:"required"`
	Brand            string  `json:"brand"`
	Calories         float64 `json:"calories" validate:"gte=0"`
	Protein          float64 `json:"protein" validate:"gte=0"`
	Carbs            float64 `json:"carbs" validate:"gte=0"`
	Fat              float64 `json:"fat" validate:"gte=0"`
	Fiber            float64 `json:"fiber" validate:"gte=0"`
	Sugar            float64 `json:"sugar" validate:"gte=0"`
	Sodium           float64 `json:"sodium" validate:"gte=0"`
	Cholesterol      float64 `json:"cholesterol" validate:"gte=0"`
	ServingSize      string  `json:"serving_size"`
	ServingSizeGrams float64 `json:"serving_size_grams" validate:"gte=0"`
	ServingSizeML    float64 `json:"serving_size_ml" validate:"gte=0"`
	Barcode          string  `json:"barcode"`
	ImageURL         string  `json:"image_url"`
}

// UpdateSettingsRequest is a PATCH: every field is a pointer so a nil (absent
// from the JSON) is distinguishable from an intentional 0. Only non-nil fields
// are applied — a partial update never zeroes the fields it omits (#37).
type UpdateSettingsRequest struct {
	WeightUnit        *string `json:"weight_unit" validate:"omitempty,oneof=lbs kg"`
	CalorieTarget     *int    `json:"calorie_target" validate:"omitempty,gte=0"`
	ProteinTarget     *int    `json:"protein_target" validate:"omitempty,gte=0"`
	CarbTarget        *int    `json:"carb_target" validate:"omitempty,gte=0"`
	FatTarget         *int    `json:"fat_target" validate:"omitempty,gte=0"`
	CholesterolTarget *int    `json:"cholesterol_target" validate:"omitempty,gte=0"`
	SodiumTarget      *int    `json:"sodium_target" validate:"omitempty,gte=0"`
	FoodAllergies     *string `json:"food_allergies" validate:"omitempty,max=500"`
	FoodDislikes      *string `json:"food_dislikes" validate:"omitempty,max=500"`
	FoodLikes         *string `json:"food_likes" validate:"omitempty,max=500"`
	// PlanHistoryStart accepts "" (reset to the journey start) as well as a
	// date, so it can't use `omitempty,datetime=...` — a non-nil pointer to ""
	// must survive validation. It's checked explicitly in UpdateSettings.
	PlanHistoryStart *string `json:"plan_history_start"`
	// AIHealthInsightsOptIn is the user's consent to send health data to the
	// configured third-party LLM. Nil leaves the stored value untouched.
	AIHealthInsightsOptIn *bool `json:"ai_health_insights_opt_in"`
	// SessionMaxDays is how long a remembered device stays signed in. The
	// upper bound is enforced in the controller against the operator's
	// MAX_SESSION_DAYS rather than as a tag, since the ceiling is configurable.
	SessionMaxDays *int `json:"session_max_days" validate:"omitempty,gte=1"`
	// TrackEffort accepts "" (off) as a meaningful value, so it can't use
	// `omitempty,oneof=...` — that tag would reject the very value that turns
	// the feature back off. The allowed set is checked explicitly instead.
	TrackEffort *string `json:"track_effort"`
}

// ValidTrackEffort reports whether v is a supported effort scale. "" is valid
// and means the per-set effort control is hidden.
func ValidTrackEffort(v string) bool {
	return v == "" || v == "rpe" || v == "rir"
}

type Program struct {
	ID         int64             `json:"id"`
	UserID     int64             `json:"user_id,omitempty"`
	Name       string            `json:"name"`
	Notes      string            `json:"notes"`
	IsShared   bool              `json:"is_shared"`
	OwnerEmail string            `json:"owner_email,omitempty"`
	CreatedAt  time.Time         `json:"created_at"`
	LastUsedAt *time.Time        `json:"last_used_at,omitempty"`
	Exercises  []ProgramExercise `json:"exercises"`
}

type ProgramExercise struct {
	ID          int64        `json:"id,omitempty"`
	ProgramID   int64        `json:"program_id,omitempty"`
	ExerciseID  int64        `json:"exercise_id"`
	OrderIndex  int          `json:"order_index,omitempty"`
	Notes       string       `json:"notes"`
	RestSeconds int          `json:"rest_seconds"`
	Exercise    Exercise     `json:"exercise"`
	Sets        []ProgramSet `json:"sets"`
}

type ProgramSet struct {
	ID                int64   `json:"id,omitempty"`
	ProgramExerciseID int64   `json:"program_exercise_id,omitempty"`
	SetNumber         int     `json:"set_number"`
	TargetReps        int     `json:"target_reps"`
	TargetWeight      float64 `json:"target_weight"`
}

type CreateProgramRequest struct {
	Name      string                     `json:"name" validate:"required"`
	Notes     string                     `json:"notes"`
	Exercises []CreateProgramExerciseReq `json:"exercises"`
}

type CreateProgramExerciseReq struct {
	ExerciseID  int64                 `json:"exercise_id" validate:"required"`
	Notes       string                `json:"notes"`
	RestSeconds int                   `json:"rest_seconds"`
	Sets        []CreateProgramSetReq `json:"sets"`
}

type CreateProgramSetReq struct {
	SetNumber    int     `json:"set_number"`
	TargetReps   int     `json:"target_reps"`
	TargetWeight float64 `json:"target_weight"`
}

// GenerateProgramRequest is the input to the AI program builder (POST
// /programs/generate). It never persists anything itself — see
// controllers.GenerateProgram.
type GenerateProgramRequest struct {
	Goals        string `json:"goals" validate:"required"`
	FocusAreas   string `json:"focus_areas"`
	Equipment    string `json:"equipment"`
	TimePeriod   string `json:"time_period"`
	NumberOfDays int    `json:"number_of_days" validate:"required,gte=1,lte=14"`
}

type DailyStats struct {
	Date             string  `json:"date"`
	TotalCalories    float64 `json:"total_calories"`
	TotalProtein     float64 `json:"total_protein"`
	TotalCarbs       float64 `json:"total_carbs"`
	TotalFat         float64 `json:"total_fat"`
	TotalFiber       float64 `json:"total_fiber"`
	TotalSodium      float64 `json:"total_sodium"`
	TotalCholesterol float64 `json:"total_cholesterol"`
	WorkoutCount     int     `json:"workout_count"`
}

// ReplaceScheduleRequest swaps the whole recurring weekly pattern. Keys are
// weekday numbers as strings ("0" = Sunday), because JSON object keys are
// always strings; the controller parses and range-checks them.
type ReplaceScheduleRequest struct {
	Days map[string][]int64 `json:"days"`
}

// SetScheduleOverrideRequest replaces one date's plan. An empty or omitted
// ProgramIDs means an explicit rest day — meaningfully different from having no
// override, which falls through to the recurring pattern.
type SetScheduleOverrideRequest struct {
	Date       string  `json:"date" validate:"required"`
	ProgramIDs []int64 `json:"program_ids"`
}
