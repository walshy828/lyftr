package models

import (
	"strings"
	"time"
)

type User struct {
	ID        int64     `json:"id" db:"id"`
	Email     string    `json:"email" db:"email"`
	Name      string    `json:"name" db:"name"`
	Password  string    `json:"-" db:"password_hash"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
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
	ServingSizeGrams float64   `json:"serving_size_grams" db:"serving_size_grams"`
	Barcode          string    `json:"barcode,omitempty" db:"barcode"`
	ImageURL         string    `json:"image_url,omitempty" db:"image_url"`
	Source           string    `json:"source,omitempty" db:"source"` // "off" | "fdc" | "saved" | "manual" | "photo" | "ai"
	LoggedAt         time.Time `json:"logged_at" db:"logged_at"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
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
	ServingSizeGrams float64       `json:"serving_size_grams,omitempty"`
	Portions         []FoodPortion `json:"portions,omitempty"`
	ImageURL         string        `json:"image_url,omitempty"`
	Source           string        `json:"source"` // "off" | "fdc" | "saved" | "manual" | "photo"
}

type FoodHistoryPoint struct {
	Date     string  `json:"date"`
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Carbs    float64 `json:"carbs"`
	Fat      float64 `json:"fat"`
}

// Request/Response types

type RegisterRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
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
