// Package vision provides a provider-agnostic abstraction for extracting
// structured nutrition data from a photo of a nutrition facts label, and for
// parsing a free-text meal description into discrete food items with
// estimated nutrition. Exactly one provider is active per deployment,
// selected via the VISION_PROVIDER env var — there is no per-request
// provider switching.
package vision

import (
	"context"
	"fmt"
	"strings"
)

// NutritionExtraction is the normalized shape every provider returns. The
// controller, frontend, and rest of the backend are unaware of which
// provider produced it — it is always a best-effort suggestion, never
// persisted directly.
type NutritionExtraction struct {
	Name        string  `json:"name,omitempty"`
	Brand       string  `json:"brand,omitempty"`
	Calories    float64 `json:"calories"`
	Protein     float64 `json:"protein"`
	Carbs       float64 `json:"carbs"`
	Fat         float64 `json:"fat"`
	Fiber       float64 `json:"fiber"`
	Sugar       float64 `json:"sugar"`
	Sodium      float64 `json:"sodium"`
	Cholesterol float64 `json:"cholesterol"`
	ServingSize string  `json:"serving_size,omitempty"`
}

// MealItem is one food item parsed out of a free-text meal description. The
// nutrition fields are the estimated totals for the item as described (e.g.
// "2 slices of turkey on honey wheat bread with mayo" as a whole sandwich),
// not per-serving or per-100g values.
type MealItem struct {
	Name        string  `json:"name"`
	Quantity    string  `json:"quantity,omitempty"`
	Calories    float64 `json:"calories"`
	Protein     float64 `json:"protein"`
	Carbs       float64 `json:"carbs"`
	Fat         float64 `json:"fat"`
	Fiber       float64 `json:"fiber"`
	Sugar       float64 `json:"sugar"`
	Sodium      float64 `json:"sodium"`
	Cholesterol float64 `json:"cholesterol"`
	ServingSize string  `json:"serving_size,omitempty"`
}

// RecommendRequest carries everything the model needs to suggest meals. The
// controller assembles it server-side (remaining budget = targets minus what
// was already logged today, preferences from user_settings, recent log names)
// so providers stay stateless.
type RecommendRequest struct {
	Meal              string  // "breakfast", "lunch", "dinner", or "snacks"
	RemainingCalories float64 // clamped >= 0 by the caller
	RemainingProtein  float64 // grams
	RemainingCarbs    float64 // grams
	RemainingFat      float64 // grams
	Allergies         string  // free-text list; hard exclusions
	Dislikes          string  // free-text list; soft avoid
	Likes             string  // free-text list; taste signal
	RecentFoods       []string
}

// MealRecommendation is one suggested meal. Items reuse MealItem so a
// recommendation can be logged directly with no extra mapping — like every
// other vision result it is a suggestion, never persisted by the provider.
type MealRecommendation struct {
	Title       string     `json:"title"`
	Description string     `json:"description"` // one sentence on why it fits the remaining budget/preferences
	Items       []MealItem `json:"items"`
}

// MealPhotoItem is one food item identified in a meal photo, extending
// MealItem with the per-item reasoning the photo-review UI surfaces to the
// user so they can judge how much to trust the estimate.
type MealPhotoItem struct {
	Name             string  `json:"name"`
	Quantity         string  `json:"quantity,omitempty"`
	Calories         float64 `json:"calories"`
	Protein          float64 `json:"protein"`
	Carbs            float64 `json:"carbs"`
	Fat              float64 `json:"fat"`
	Fiber            float64 `json:"fiber"`
	Sugar            float64 `json:"sugar"`
	Sodium           float64 `json:"sodium"`
	Cholesterol      float64 `json:"cholesterol"`
	ServingSize      string  `json:"serving_size,omitempty"`
	Confidence       string  `json:"confidence,omitempty"`        // "high", "medium", or "low"
	PortionReasoning string  `json:"portion_reasoning,omitempty"` // how the portion size was estimated, e.g. relative to plate/utensils
}

// MealPhotoAnalysis is the full result of analyzing a meal photo (plus
// optional accompanying text) — like every other vision result it is a
// suggestion, never persisted directly by the provider.
type MealPhotoAnalysis struct {
	Items      []MealPhotoItem `json:"items"`
	Assessment string          `json:"assessment,omitempty"` // one or two sentences of overall nutritional commentary
}

// ExerciseRef is the compact per-exercise projection injected into the
// program-generation prompt so the model can only ever reference exercises
// that actually exist — the full Exercise record (description, images,
// video) is intentionally omitted to keep the catalog small.
type ExerciseRef struct {
	ID          int64
	Name        string
	MuscleGroup string
	Equipment   string
	Category    string
}

// GenerateProgramRequest carries everything the model needs to propose one
// or more workout programs. The controller assembles Catalog server-side
// (the full exercise library) so providers stay stateless and never invent
// an exercise_id that doesn't exist.
type GenerateProgramRequest struct {
	Goals        string // required — the program's overall objective
	FocusAreas   string // free text, e.g. "strength and agility"
	Equipment    string // free text list of available equipment
	TimePeriod   string // free text, e.g. "6 weeks"
	NumberOfDays int    // number of distinct programs (days) to generate, >= 1
	Catalog      []ExerciseRef
}

// DraftProgramSet mirrors models.CreateProgramSetReq so a DraftProgram can be
// handed to the existing program-create endpoint unchanged once the user
// accepts it.
type DraftProgramSet struct {
	SetNumber    int     `json:"set_number"`
	TargetReps   int     `json:"target_reps"`
	TargetWeight float64 `json:"target_weight"`
}

// DraftProgramExercise mirrors models.CreateProgramExerciseReq.
type DraftProgramExercise struct {
	ExerciseID  int64             `json:"exercise_id"`
	Notes       string            `json:"notes"`
	RestSeconds int               `json:"rest_seconds"`
	Sets        []DraftProgramSet `json:"sets"`
}

// DraftProgram mirrors models.CreateProgramRequest. Like every other vision
// result, it is always a best-effort suggestion — never persisted directly
// by the provider or the controller that calls it.
type DraftProgram struct {
	Name      string                 `json:"name"`
	Notes     string                 `json:"notes"`
	Exercises []DraftProgramExercise `json:"exercises"`
}

// MatchCandidate is one exercise the model may match an in-use exercise to —
// the target library's catalog, keyed by name rather than ID since the target
// library's rows don't exist in the database yet at match time (the
// exercise-migration preview runs before the new library is seeded; see
// controllers/exercise_migration.go and seed.FetchCatalog).
type MatchCandidate struct {
	Name, MuscleGroup, Equipment, Category string
}

// MatchExercisesRequest carries the exercises a user actually has logged
// history against (referenced by a workout or program) that need a new home
// in the target library, plus the full target catalog to choose from. Like
// GenerateProgramRequest.Catalog, the controller assembles both slices
// server-side so the provider stays stateless and never invents an exercise.
type MatchExercisesRequest struct {
	InUse   []ExerciseRef
	Catalog []MatchCandidate
}

// ExerciseMatch is the model's proposed mapping for one in-use exercise.
// MatchedName is empty when nothing in the catalog is a good match — the
// caller must not invent a fallback for that case, it's a deliberate signal
// to leave that exercise's history unmigrated (see the exercise-migration
// confirm flow's "leave unmigrated" handling for anything below "high"
// confidence or with no match at all).
type ExerciseMatch struct {
	OldExerciseID int64  `json:"old_exercise_id"`
	MatchedName   string `json:"matched_name,omitempty"`
	Confidence    string `json:"confidence"` // "high" | "medium" | "low"
	Reasoning     string `json:"reasoning,omitempty"`
}

// GenerateWeightPlanRequest carries everything the model needs to propose a
// weight-loss nutrition plan. BMI and the healthy weight range are computed
// deterministically by the controller (utils.BMI/HealthyWeightRangeLbs) and
// passed in rather than left for the model to compute.
type GenerateWeightPlanRequest struct {
	Age              int
	Sex              string // "male" or "female"
	ActivityLevel    string // "sedentary"|"light"|"moderate"|"active"|"very_active"
	HeightInches     float64
	CurrentWeight    float64 // lbs
	TargetWeight     float64 // lbs, as requested by the user
	TimeframeWeeks   int     // 0 = no preference, let the model choose a safe pace
	HealthyRangeLow  float64 // lbs
	HealthyRangeHigh float64 // lbs
	// BMICategory and the loss-rate bounds are computed deterministically by
	// the controller (utils.BMICategory/WeeklyLossGuidanceFor) from the
	// user's current BMI — they set the sustainable-phase pace the model
	// should taper toward, scaled to how much this person's starting point
	// can safely sustain.
	BMICategory            string
	SustainedLossLowPerWk  float64 // lbs/week
	SustainedLossHighPerWk float64 // lbs/week
	// The energy figures the app computes itself (utils.BuildPlanEnergyBasis)
	// and displays next to the model's write-up. They're passed in so the
	// model reasons from the same arithmetic the user is shown, rather than
	// estimating its own TDEE and visibly contradicting the table on screen.
	BMR                 int // resting burn, kcal/day
	MaintenanceCalories int // BMR x the profile activity multiplier
	CalorieFloor        int // lowest intake the app will recommend for this sex
	ProteinLowGrams     int
	ProteinHighGrams    int
	FatLowGrams         int
	FatHighGrams        int
}

// WeightPlanWeek is one week of the AI-projected weight trajectory.
type WeightPlanWeek struct {
	Week           int     `json:"week"`
	ExpectedWeight float64 `json:"expected_weight"`
}

// DraftWeightPlan is the AI's proposed nutrition plan — like every other
// vision result, always a suggestion, never persisted by the provider.
type DraftWeightPlan struct {
	CalorieTarget    int              `json:"calorie_target"`
	ProteinTarget    int              `json:"protein_target"`
	CarbTarget       int              `json:"carb_target"`
	FatTarget        int              `json:"fat_target"`
	WeeklyTrajectory []WeightPlanWeek `json:"weekly_trajectory"`
	Rationale        string           `json:"rationale"`
	SafetyNotes      string           `json:"safety_notes"`
	// Detail is the structured, renderable write-up — headed bullet sections
	// instead of one prose blob, so the UI can lay it out without a markdown
	// parser. Rationale/SafetyNotes are kept as the flat fallback for anything
	// reading the plain-text form.
	Detail PlanDetail `json:"detail"`
}

// PlanSection is one headed group of bullets in a structured plan write-up.
type PlanSection struct {
	Heading string   `json:"heading"`
	Bullets []string `json:"bullets"`
}

// PlanDetail is a plan explanation as a one-line summary plus headed sections.
type PlanDetail struct {
	Summary  string        `json:"summary"`
	Sections []PlanSection `json:"sections"`
}

// MotivationNoteRequest carries the adherence signals and today's date so the
// model can write one short, timely, encouraging message — including
// seasonal/holiday context when it naturally fits.
type MotivationNoteRequest struct {
	CurrentDate   string // e.g. "2026-07-23" — lets the model reason about season/holidays
	BehindPlan    bool
	VarianceLbs   float64 // actual minus expected weight; positive = behind (heavier than planned)
	Drivers       []string
	WeeksIntoPlan int
}

// ProgressCheckinRequest carries the fully-computed picture of a user's
// journey so the model only has to interpret, never to calculate. Everything
// here is derived server-side from weight/food/workout logs — see
// controllers.buildCheckinFacts.
//
// FactsJSON is the whole models.CheckinFacts blob, passed verbatim so the
// model can reference any detail (the weekly variance table, the per-window
// adherence numbers) without this struct having to mirror every field. The
// named fields above it are the ones the prompt text interpolates directly.
type ProgressCheckinRequest struct {
	CurrentDate   string // "2026-08-07"
	Sex           string
	Age           int
	WeeksIntoPlan int

	StartWeight       float64
	CurrentWeight     float64
	TargetWeight      float64
	ExpectedWeightNow float64
	PctBodyWeightLost float64
	BMICategory       string

	// The overall-vs-recent contrast, in lbs LOST per week (negative = gaining).
	OverallLbsPerWeek float64
	RecentLbsPerWeek  float64
	RecentWindowDays  int
	PlanLbsPerWeek    float64
	Pattern           string // see models.CheckinPattern* — the deterministic verdict

	CalorieTarget int
	ProteinTarget int

	FactsJSON string
}

// CheckinBenchmark is one peer-comparison row. The model supplies these
// values; the app does not compute or verify them, which is why the prompt
// demands ranges over point estimates and forbids invented citations.
type CheckinBenchmark struct {
	Label        string `json:"label"`
	UserValue    string `json:"user_value"`
	TypicalRange string `json:"typical_range"`
	Verdict      string `json:"verdict"`
	Context      string `json:"context"`
}

// CheckinPoint is a titled observation ("what's working" / "what's slipping").
type CheckinPoint struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// CheckinRecommendation is one concrete change plus why it tends to work.
type CheckinRecommendation struct {
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	WhyItWorks string `json:"why_it_works"`
	Effort     string `json:"effort"`
}

// ProgressCheckinReport is the AI's coaching read on a journey. Overall and
// recent assessments are separate fields on purpose: the case this feature
// exists to catch — on plan overall but stalled for three weeks — disappears
// if the model is allowed to average them into one verdict.
type ProgressCheckinReport struct {
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

// Provider is implemented once per vision backend (Anthropic/OpenAI/Gemini).
type Provider interface {
	// AnalyzeLabel takes a base64-encoded photo of a nutrition facts label
	// (imageBase64, no data: URI prefix) and its MIME type, and returns a
	// best-effort structured extraction. Implementations should tolerate an
	// unreadable or label-less photo by returning a mostly-zeroed
	// NutritionExtraction rather than an error — an error is reserved for
	// genuine provider/network/auth failures.
	AnalyzeLabel(ctx context.Context, imageBase64, mediaType string) (NutritionExtraction, error)

	// ParseMeal takes a free-text meal description and splits it into the
	// discrete food items a person would log separately, each with
	// best-effort estimated nutrition. Implementations should tolerate a
	// description with no recognizable food by returning an empty slice
	// rather than an error — an error is reserved for genuine
	// provider/network/auth failures.
	ParseMeal(ctx context.Context, description string) ([]MealItem, error)

	// RecommendMeals suggests 2-3 meals sized to the user's remaining daily
	// macro budget, honoring allergies as hard exclusions and dislikes/likes/
	// recent foods as soft taste signals. Empty preference fields are fine —
	// an error is reserved for genuine provider/network/auth failures.
	RecommendMeals(ctx context.Context, req RecommendRequest) ([]MealRecommendation, error)

	// AnalyzeMealPhoto takes a base64-encoded photo of a meal (imageBase64,
	// no data: URI prefix), its MIME type, and an optional free-text
	// description that supplements/clarifies what's in the photo, and
	// returns a best-effort breakdown of discrete food items with portion
	// and nutrition estimates, per-item confidence/reasoning, and an overall
	// assessment. Implementations should tolerate a photo with no
	// recognizable food by returning an empty items slice rather than an
	// error — an error is reserved for genuine provider/network/auth
	// failures.
	AnalyzeMealPhoto(ctx context.Context, imageBase64, mediaType, description string) (MealPhotoAnalysis, error)

	// GenerateProgram proposes one or more draft workout programs from a
	// free-text description of goals/focus areas/equipment/time period,
	// grounded in the exercise catalog passed in req.Catalog so every
	// returned exercise_id is guaranteed to exist. Like every other vision
	// result this is always a suggestion — the caller is responsible for
	// persisting any draft the user accepts. Implementations should return
	// exactly req.NumberOfDays program drafts.
	GenerateProgram(ctx context.Context, req GenerateProgramRequest) ([]DraftProgram, error)

	// MatchExercises proposes, for each in-use exercise in req.InUse, the
	// best-matching exercise (by name) in req.Catalog — used by the exercise-
	// migration flow when switching the active library. Implementations must
	// only return names that appear verbatim in req.Catalog (never invent one)
	// and must return an empty MatchedName with confidence "low" when nothing
	// is a good match, rather than forcing a bad one. Always return exactly
	// len(req.InUse) results, one per input, so the caller can align by index
	// or OldExerciseID without guessing which inputs were dropped.
	MatchExercises(ctx context.Context, req MatchExercisesRequest) ([]ExerciseMatch, error)

	// GenerateWeightPlan proposes daily nutrition targets and a week-by-week
	// expected-weight trajectory toward req.TargetWeight, honoring a safe
	// maximum rate of loss (~1-2 lbs/week) and a safe minimum calorie floor.
	// If the requested target falls outside req.HealthyRangeLow/High, the
	// model should aim for the nearer healthy-range boundary instead and say
	// so in Rationale/SafetyNotes. Like every other vision result this is
	// always a suggestion — the caller persists it only if the user accepts.
	GenerateWeightPlan(ctx context.Context, req GenerateWeightPlanRequest) (DraftWeightPlan, error)

	// GenerateMotivationNote writes one short, encouraging message (1-3
	// sentences) grounded in the user's actual adherence data, optionally
	// weaving in relevant seasonal/holiday context for req.CurrentDate when
	// it fits naturally. Called at most once per user per calendar week by
	// the caller (results are cached) — never invoke this on every page load.
	GenerateMotivationNote(ctx context.Context, req MotivationNoteRequest) (string, error)

	// GenerateProgressCheckin writes the coaching read on a whole weight-loss
	// journey: how the plan is going overall, how the last few weeks compare
	// to that, how the user's numbers sit against what people in the same
	// situation typically see, what's working, what's slipping, and what to
	// change. Every figure it reasons from is precomputed in req — the model
	// interprets, it does not calculate.
	//
	// The peer benchmarks it returns are the model's own, not values the app
	// verifies, so implementations must pass the shared prompt through
	// unmodified: it is what constrains those numbers to honest ranges. This
	// is user-triggered and slow — callers must not invoke it on page load.
	GenerateProgressCheckin(ctx context.Context, req ProgressCheckinRequest) (ProgressCheckinReport, error)

	// GenerateBPInsight interprets a precomputed blood-pressure picture: where
	// the user's averages fall against the ACC/AHA categories, whether the
	// direction of travel is good, which of their own logged behaviours
	// (weight change, training frequency, sodium intake) plausibly bear on it,
	// a concrete plan when averages are out of range, and how to measure
	// better. Every threshold in req is already decided by the app — the model
	// interprets and must never state a different category. Slow and
	// user-triggered; callers must not invoke it on page load.
	GenerateBPInsight(ctx context.Context, req BPInsightRequest) (BPInsightReport, error)
}

// Config carries the selected provider, all three providers' API keys — only
// the one named by VisionProvider needs to be set — and optional per-provider
// model overrides. Leaving a model override empty falls back to that
// provider's built-in default constant.
type Config struct {
	VisionProvider  string // "", "anthropic", "openai", or "gemini"
	AnthropicAPIKey string
	OpenAIAPIKey    string
	GeminiAPIKey    string
	AnthropicModel  string // defaults to anthropicModel if empty
	OpenAIModel     string // defaults to openAIModel if empty
	GeminiModel     string // defaults to geminiModel if empty
}

// extractionPrompt is shared across all three providers so their prompts
// and schemas can't drift apart — every implementation must request exactly
// this field set.
const extractionPrompt = `Look at this photo of a nutrition facts label and extract the following fields as JSON: name (the product name, if visible), brand (if visible), calories, protein (grams), carbs (grams), fat (grams), fiber (grams), sugar (grams), sodium (milligrams), cholesterol (milligrams), serving_size (as printed on the label, e.g. "1 cup (240ml)").

Use the per-serving values as printed on the label. If a field isn't visible or the label can't be read, use 0 for numeric fields and omit name/brand/serving_size rather than guessing.`

// mealParsePrompt is shared across all three providers for text meal parsing.
const mealParsePrompt = `Split the following free-text meal description into the discrete food items a person would log separately in a food diary — e.g. combine a sandwich's stated ingredients (bread, meat, condiments) into one "sandwich" item, but keep a separate drink or side as its own item. For each item return: name, quantity (the amount as described, e.g. "1 sandwich" or "12 fl oz can"), calories, protein (grams), carbs (grams), fat (grams), fiber (grams), sugar (grams), sodium (milligrams), cholesterol (milligrams), serving_size (a short label for the amount, usually the same as quantity).

Estimate nutrition for the totals of what's described for that item, not per-100g or per-single-unit values. Only include items for food or drink actually mentioned — never invent items that weren't described. If the description contains no recognizable food, return an empty items array.

Meal description: `

// mealPhotoAnalysisPrompt is shared across all three providers for meal
// photo analysis.
const mealPhotoAnalysisPrompt = `Look at this photo of a meal and identify each discrete food item a person would log separately in a food diary — e.g. combine a sandwich's visible ingredients into one "sandwich" item, but keep a separate drink or side as its own item. For each item estimate its portion size from visual cues (relative to the plate, utensils, or other objects in frame) and return: name, quantity (the estimated amount, e.g. "1 sandwich" or "12 fl oz can"), calories, protein (grams), carbs (grams), fat (grams), fiber (grams), sugar (grams), sodium (milligrams), cholesterol (milligrams), serving_size (a short label for the amount, usually the same as quantity), confidence ("high", "medium", or "low" — how sure you are about the identification and portion estimate), and portion_reasoning (one short sentence on how you estimated the portion size, e.g. "roughly half the 10-inch plate").

If a text description is also provided, use it to confirm or adjust identifications and portions — the photo is authoritative for what's visible, but the text can clarify ambiguous items or add ones not clearly visible.

Also return a top-level assessment: one or two sentences of overall nutritional commentary on the meal as a whole (e.g. macro balance, anything notably high or low).

Only include items for food or drink actually visible or described — never invent items. If no recognizable food is visible, return an empty items array.`

// mealPhotoDescriptionPrefix precedes any accompanying free-text description
// appended to mealPhotoAnalysisPrompt.
const mealPhotoDescriptionPrefix = "\n\nAccompanying description from the user: "

// mealPhotoAnalysisPromptWithDescription builds the full prompt for
// AnalyzeMealPhoto, appending the optional user-supplied description (if
// any) in a consistent way across all three providers.
func mealPhotoAnalysisPromptWithDescription(description string) string {
	if description == "" {
		return mealPhotoAnalysisPrompt
	}
	return mealPhotoAnalysisPrompt + mealPhotoDescriptionPrefix + description
}

// mealPhotoItemJSONSchema is the per-item schema for AnalyzeMealPhoto. Kept
// as its own explicit flat field list (rather than merging/embedding
// mealItemJSONSchema()) so schema drift is caught at a glance in review.
func mealPhotoItemJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name":              map[string]any{"type": "string"},
			"quantity":          map[string]any{"type": "string"},
			"calories":          map[string]any{"type": "number"},
			"protein":           map[string]any{"type": "number"},
			"carbs":             map[string]any{"type": "number"},
			"fat":               map[string]any{"type": "number"},
			"fiber":             map[string]any{"type": "number"},
			"sugar":             map[string]any{"type": "number"},
			"sodium":            map[string]any{"type": "number"},
			"cholesterol":       map[string]any{"type": "number"},
			"serving_size":      map[string]any{"type": "string"},
			"confidence":        map[string]any{"type": "string"},
			"portion_reasoning": map[string]any{"type": "string"},
		},
		"required":             []string{"name", "calories", "protein", "carbs", "fat"},
		"additionalProperties": false,
	}
}

// mealPhotoAnalysisJSONSchema is the JSON schema all three providers'
// structured output requests should target for AnalyzeMealPhoto.
func mealPhotoAnalysisJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"items": map[string]any{
				"type":  "array",
				"items": mealPhotoItemJSONSchema(),
			},
			"assessment": map[string]any{"type": "string"},
		},
		"required":             []string{"items"},
		"additionalProperties": false,
	}
}

// mealItemJSONSchema is the per-item schema shared by mealParseJSONSchema and
// mealRecommendJSONSchema — it mirrors the MealItem struct.
func mealItemJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name":         map[string]any{"type": "string"},
			"quantity":     map[string]any{"type": "string"},
			"calories":     map[string]any{"type": "number"},
			"protein":      map[string]any{"type": "number"},
			"carbs":        map[string]any{"type": "number"},
			"fat":          map[string]any{"type": "number"},
			"fiber":        map[string]any{"type": "number"},
			"sugar":        map[string]any{"type": "number"},
			"sodium":       map[string]any{"type": "number"},
			"cholesterol":  map[string]any{"type": "number"},
			"serving_size": map[string]any{"type": "string"},
		},
		"required":             []string{"name", "calories", "protein", "carbs", "fat"},
		"additionalProperties": false,
	}
}

// mealParseJSONSchema is the JSON schema all three providers' structured
// output requests should target for ParseMeal.
func mealParseJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"items": map[string]any{
				"type":  "array",
				"items": mealItemJSONSchema(),
			},
		},
		"required":             []string{"items"},
		"additionalProperties": false,
	}
}

// mealRecommendPrompt builds the shared RecommendMeals prompt — one builder
// used by all three providers so their prompts can't drift apart. Allergies
// are stated as a hard safety constraint; dislikes/likes/recent foods are
// soft signals; the remaining macro budget bounds each suggestion.
func mealRecommendPrompt(req RecommendRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Suggest exactly 2 or 3 realistic %s options for one person to eat today. Each recommendation needs a short title, a one-sentence description of why it fits the user's remaining nutrition budget and tastes, and the list of discrete food items it consists of (as a person would log them in a food diary).\n\n", req.Meal)

	if req.RemainingCalories < 200 {
		b.WriteString("The user has nearly or fully used up their calorie target for today — suggest light, low-calorie options rather than exceeding the budget.\n")
	}
	fmt.Fprintf(&b, "Remaining daily budget: approximately %.0f kcal, %.0fg protein, %.0fg carbs, %.0fg fat. Each suggestion should fit within this budget while prioritizing whichever macro has the most room left.\n", req.RemainingCalories, req.RemainingProtein, req.RemainingCarbs, req.RemainingFat)

	if req.Allergies != "" {
		fmt.Fprintf(&b, "\nCRITICAL SAFETY CONSTRAINT: the user is allergic to: %s. Never include these ingredients or foods that commonly contain them.\n", req.Allergies)
	}
	if req.Dislikes != "" {
		fmt.Fprintf(&b, "Avoid these foods the user dislikes: %s.\n", req.Dislikes)
	}
	if req.Likes != "" {
		fmt.Fprintf(&b, "The user enjoys: %s.\n", req.Likes)
	}
	if len(req.RecentFoods) > 0 {
		fmt.Fprintf(&b, "Foods the user logged recently (use as a taste/cuisine signal, but prefer variety — don't repeat the exact same meals): %s.\n", strings.Join(req.RecentFoods, ", "))
	}

	b.WriteString("\nFor each item return: name, quantity (e.g. \"1 sandwich\" or \"12 fl oz can\"), calories, protein (grams), carbs (grams), fat (grams), fiber (grams), sugar (grams), sodium (milligrams), cholesterol (milligrams), serving_size (a short label for the amount, usually the same as quantity). Estimate nutrition for the totals of the item as described, not per-100g or per-single-unit values.")
	return b.String()
}

// mealRecommendJSONSchema is the JSON schema all three providers' structured
// output requests should target for RecommendMeals.
func mealRecommendJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"recommendations": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"title":       map[string]any{"type": "string"},
						"description": map[string]any{"type": "string"},
						"items": map[string]any{
							"type":  "array",
							"items": mealItemJSONSchema(),
						},
					},
					"required":             []string{"title", "description", "items"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"recommendations"},
		"additionalProperties": false,
	}
}

// generateProgramPrompt builds the shared GenerateProgram prompt — one
// builder used by all three providers so their prompts can't drift apart.
// The exercise catalog is serialized as "id: name (muscle_group, equipment,
// category)" lines, one per exercise, so the model can pick real IDs while
// reasoning over the same fields a human would.
func generateProgramPrompt(req GenerateProgramRequest) string {
	var b strings.Builder
	if req.NumberOfDays > 1 {
		fmt.Fprintf(&b, "Design a %d-day workout program split, returning exactly %d separate program objects (one per day). Name each program \"<short theme> — Day X of %d\" using a consistent theme across all %d, e.g. \"Hockey Strength — Day 1 of %d\".\n\n", req.NumberOfDays, req.NumberOfDays, req.NumberOfDays, req.NumberOfDays, req.NumberOfDays)
	} else {
		b.WriteString("Design a single workout program, returning exactly one program object. Give it a short, descriptive name with no day/number suffix.\n\n")
	}

	fmt.Fprintf(&b, "Goals: %s\n", req.Goals)
	if req.FocusAreas != "" {
		fmt.Fprintf(&b, "Focus areas: %s\n", req.FocusAreas)
	}
	if req.Equipment != "" {
		fmt.Fprintf(&b, "Available equipment: %s\n", req.Equipment)
	}
	if req.TimePeriod != "" {
		fmt.Fprintf(&b, "Intended time period to run this program: %s\n", req.TimePeriod)
	}

	b.WriteString("\nEach program needs a notes field (one or two sentences summarizing that day's focus) and an ordered list of exercises. For each exercise return: exercise_id (an integer — you MUST choose only from the catalog below, never invent one), notes (a short coaching cue, may be empty), rest_seconds (typical rest between sets for this goal, e.g. 60-180), and sets — a list of {set_number, target_reps, target_weight}. Always set target_weight to 0; the user fills in their own working weights. Choose target_reps appropriate to the stated goals (e.g. lower reps for strength/power, higher reps for endurance/conditioning). Prefer exercises whose equipment matches what's available; if no equipment is listed, prefer bodyweight exercises. Only use exercises from the catalog below — every exercise_id in your response must be one of the ids listed.\n\nExercise catalog (id: name (muscle_group, equipment, category)):\n")
	for _, e := range req.Catalog {
		fmt.Fprintf(&b, "%d: %s (%s, %s, %s)\n", e.ID, e.Name, e.MuscleGroup, e.Equipment, e.Category)
	}
	return b.String()
}

// draftProgramJSONSchema is the JSON schema all three providers' structured
// output requests should target for GenerateProgram.
func draftProgramJSONSchema() map[string]any {
	setSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"set_number":    map[string]any{"type": "integer"},
			"target_reps":   map[string]any{"type": "integer"},
			"target_weight": map[string]any{"type": "number"},
		},
		"required":             []string{"set_number", "target_reps", "target_weight"},
		"additionalProperties": false,
	}
	exerciseSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"exercise_id":  map[string]any{"type": "integer"},
			"notes":        map[string]any{"type": "string"},
			"rest_seconds": map[string]any{"type": "integer"},
			"sets": map[string]any{
				"type":  "array",
				"items": setSchema,
			},
		},
		"required":             []string{"exercise_id", "rest_seconds", "sets"},
		"additionalProperties": false,
	}
	programSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name":  map[string]any{"type": "string"},
			"notes": map[string]any{"type": "string"},
			"exercises": map[string]any{
				"type":  "array",
				"items": exerciseSchema,
			},
		},
		"required":             []string{"name", "exercises"},
		"additionalProperties": false,
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"programs": map[string]any{
				"type":  "array",
				"items": programSchema,
			},
		},
		"required":             []string{"programs"},
		"additionalProperties": false,
	}
}

// matchExercisesPrompt builds the shared MatchExercises prompt — one builder
// used by all three providers so their prompts can't drift apart. The old
// (in-use) exercises are listed with their real ID so the response can be
// correlated back; the target catalog is listed by name only, since it isn't
// persisted yet at match time.
func matchExercisesPrompt(req MatchExercisesRequest) string {
	var b strings.Builder
	b.WriteString("You are migrating a workout-tracking app's exercise library from one dataset to another. For each \"exercise to match\" below, find the single best-matching exercise in the \"target catalog\" — same movement/muscle group/equipment, even if the name, capitalization, or wording differs (the two datasets use unrelated naming conventions, e.g. \"Barbell Bench Press\" vs \"barbell bench press v. 2\").\n\n")
	b.WriteString("Rules: matched_name MUST be copied verbatim (exact case and punctuation) from the target catalog below, or left empty if nothing is a genuinely equivalent movement — do not force a mismatched pick just to fill the field, and never invent a name that isn't in the catalog. Set confidence to \"high\" only when you're confident it's the same or a near-identical movement, \"medium\" for a reasonable substitute, \"low\" for a weak guess or no match at all. Give a one-sentence reasoning. Return exactly one result per exercise to match, in any order, each carrying its old_exercise_id.\n\n")

	b.WriteString("Exercises to match (id: name (muscle_group, equipment, category)):\n")
	for _, e := range req.InUse {
		fmt.Fprintf(&b, "%d: %s (%s, %s, %s)\n", e.ID, e.Name, e.MuscleGroup, e.Equipment, e.Category)
	}

	b.WriteString("\nTarget catalog (name (muscle_group, equipment, category)):\n")
	for _, c := range req.Catalog {
		fmt.Fprintf(&b, "%s (%s, %s, %s)\n", c.Name, c.MuscleGroup, c.Equipment, c.Category)
	}
	return b.String()
}

// exerciseMatchJSONSchema is the JSON schema all three providers' structured
// output requests should target for MatchExercises.
func exerciseMatchJSONSchema() map[string]any {
	matchSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"old_exercise_id": map[string]any{"type": "integer"},
			"matched_name":    map[string]any{"type": "string"},
			"confidence":      map[string]any{"type": "string", "enum": []string{"high", "medium", "low"}},
			"reasoning":       map[string]any{"type": "string"},
		},
		"required":             []string{"old_exercise_id", "matched_name", "confidence", "reasoning"},
		"additionalProperties": false,
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"matches": map[string]any{
				"type":  "array",
				"items": matchSchema,
			},
		},
		"required":             []string{"matches"},
		"additionalProperties": false,
	}
}

// weightPlanPrompt builds the shared GenerateWeightPlan prompt — one builder
// used by all three providers so their prompts can't drift apart. States the
// safety envelope explicitly so a good-faith model won't propose a crash
// diet, and explicitly asks for a non-linear, front-loaded-then-tapering
// trajectory instead of a flat straight-line decline — real weight loss
// isn't linear (a bigger drop in week 1-2 from water/glycogen depletion,
// then a steadier sustainable rate, then further tapering as the body
// adapts and there's less left to safely lose near the target).
func weightPlanPrompt(req GenerateWeightPlanRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Design a weight-loss nutrition plan for a %d-year-old %s, %.0f inches tall, currently weighing %.0f lbs, with a %s activity level. They want to reach %.0f lbs", req.Age, req.Sex, req.HeightInches, req.CurrentWeight, req.ActivityLevel, req.TargetWeight)
	if req.TimeframeWeeks > 0 {
		fmt.Fprintf(&b, " within about %d weeks", req.TimeframeWeeks)
	}
	b.WriteString(".\n\n")

	fmt.Fprintf(&b, "The generally recognized healthy weight range for this height is %.0f-%.0f lbs. If the requested target weight falls outside this range, propose a plan that instead targets the nearer edge of the healthy range, and explain this adjustment in safety_notes.\n\n", req.HealthyRangeLow, req.HealthyRangeHigh)

	fmt.Fprintf(&b, "This person's BMI category is %q. A sustainable steady-state pace for that category is about %.1f-%.1f lbs/week — use that as the target rate for the bulk of the plan, not a single universal number.\n\n", req.BMICategory, req.SustainedLossLowPerWk, req.SustainedLossHighPerWk)

	// The app shows these exact figures beside the plan, so the model must
	// reason from them instead of estimating its own — a rationale quoting a
	// different TDEE than the table next to it reads as a broken app.
	if req.MaintenanceCalories > 0 {
		fmt.Fprintf(&b, "Use these figures, already computed by the app and displayed to the user alongside your write-up — do NOT compute or quote your own: resting metabolic rate about %d kcal/day (Mifflin-St Jeor), maintenance intake at their stated activity level about %d kcal/day. Any calorie number you cite must be consistent with these. Recommended macro bands, also shown to the user: protein %d-%d g/day and fat %d-%d g/day (both derived from goal weight; carbohydrate is simply the remaining calories). Keep protein_target and fat_target inside those bands unless there's a specific reason, and state the reason in safety_notes if you go outside them.\n\n", req.BMR, req.MaintenanceCalories, req.ProteinLowGrams, req.ProteinHighGrams, req.FatLowGrams, req.FatHighGrams)
	}

	b.WriteString("IMPORTANT — make the weekly_trajectory realistic, not a flat straight-line decline: real weight loss is front-loaded and then tapers. Structure it in three phases: (1) weeks 1-2: a faster initial drop (roughly 1.5-2x the steady-state rate above) mostly from water weight and glycogen depletion — say so in rationale; (2) the middle of the plan: settle into the steady-state rate range given above; (3) the final ~20% of the plan (or once within about 5 lbs of the target): taper the weekly loss down further (metabolic adaptation and less excess to lose) so the curve visibly flattens as it approaches the target rather than hitting it in one last big drop. The result should look like a decelerating curve, never a straight line and never faster in later weeks than earlier weeks.\n\n")

	b.WriteString("Safety constraints (do not violate these): the rate of loss must never exceed about 2 lbs/week in any single week, even in the faster initial phase; daily calorie_target must never go below 1500 for a male or 1200 for a female, regardless of how aggressive the timeframe request is. If a safe, properly-tapered plan can't reach the target in the requested timeframe, extend the trajectory and say so in rationale rather than dropping calories further or exceeding the safe weekly rate.\n\n")

	b.WriteString("Return: calorie_target (integer kcal/day), protein_target, carb_target, fat_target (integer grams/day, roughly consistent with the calorie target), weekly_trajectory (an array of {week, expected_weight} starting at week 0 with the user's current weight and following the three-phase tapering pace described above to the plan's final target weight — one entry per week), rationale (one short paragraph explaining the calorie/macro choices and why the pace is shaped the way it is), and safety_notes (any caveats, including a target adjustment if you moved it toward the healthy range, or a recommendation to consult a doctor for large or rapid changes).\n\n")

	// The structured `detail` field is what the UI actually renders — headed
	// bullet sections rather than the prose blob. Markdown syntax inside
	// bullets is explicitly forbidden because the frontend renders these as
	// plain text nodes in real <h4>/<ul> elements, with no markdown parser.
	b.WriteString("Also return a `detail` object that presents the same explanation in a scannable, structured form for display. It must contain: summary (one sentence, at most ~25 words, stating the headline of the plan — e.g. the daily calorie target and the expected timeline), and sections (3 to 5 objects, each with a short heading of at most 5 words and 2 to 5 bullets). Cover, in this order where applicable: how the calorie and macro targets were derived; how the weekly trajectory is shaped and roughly when the target is reached; practical nutrition guidance for hitting these numbers; and safety guardrails and caveats. Each bullet must be a single self-contained sentence or phrase under about 20 words. Do NOT use any markdown syntax anywhere in detail — no asterisks, no dashes or bullet characters at the start of a bullet, no headings marks, no backticks. Write plain sentences; the app supplies the headings and bullet points itself. The detail sections must be consistent with rationale and safety_notes, not contradict them.")
	return b.String()
}

// weightPlanJSONSchema is the JSON schema all three providers' structured
// output requests should target for GenerateWeightPlan.
func weightPlanJSONSchema() map[string]any {
	weekSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"week":            map[string]any{"type": "integer"},
			"expected_weight": map[string]any{"type": "number"},
		},
		"required":             []string{"week", "expected_weight"},
		"additionalProperties": false,
	}
	sectionSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"heading": map[string]any{"type": "string"},
			"bullets": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
		},
		"required":             []string{"heading", "bullets"},
		"additionalProperties": false,
	}
	detailSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"summary": map[string]any{"type": "string"},
			"sections": map[string]any{
				"type":  "array",
				"items": sectionSchema,
			},
		},
		"required":             []string{"summary", "sections"},
		"additionalProperties": false,
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"calorie_target": map[string]any{"type": "integer"},
			"protein_target": map[string]any{"type": "integer"},
			"carb_target":    map[string]any{"type": "integer"},
			"fat_target":     map[string]any{"type": "integer"},
			"weekly_trajectory": map[string]any{
				"type":  "array",
				"items": weekSchema,
			},
			"rationale":    map[string]any{"type": "string"},
			"safety_notes": map[string]any{"type": "string"},
			"detail":       detailSchema,
		},
		"required":             []string{"calorie_target", "protein_target", "carb_target", "fat_target", "weekly_trajectory", "rationale", "detail"},
		"additionalProperties": false,
	}
}

// motivationNotePrompt builds the shared GenerateMotivationNote prompt.
func motivationNotePrompt(req MotivationNoteRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Today's date is %s. Write one short, warm, motivating message (1-3 sentences) for someone %d weeks into a weight-loss plan.", req.CurrentDate, req.WeeksIntoPlan)
	if req.BehindPlan {
		fmt.Fprintf(&b, " They're currently about %.1f lbs behind where their plan expected them to be.", req.VarianceLbs)
	} else {
		b.WriteString(" They're currently on track or ahead of their plan.")
	}
	if len(req.Drivers) > 0 {
		fmt.Fprintf(&b, " Contributing factors observed this week: %s.", strings.Join(req.Drivers, "; "))
	}
	b.WriteString(" If today's date is near a well-known holiday or seasonal moment, you may naturally weave that in (e.g. a tip for navigating holiday meals, or a fresh-season nudge) — but only if it fits naturally, not every time. Be encouraging and specific, never preachy or generic. Return just the message text as a JSON object with a single \"message\" field.")
	return b.String()
}

// motivationNoteJSONSchema is the JSON schema all three providers' structured
// output requests should target for GenerateMotivationNote.
func motivationNoteJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"message": map[string]any{"type": "string"},
		},
		"required":             []string{"message"},
		"additionalProperties": false,
	}
}

// progressCheckinPrompt builds the shared GenerateProgressCheckin prompt —
// one builder used by all three providers so they can't drift apart.
//
// Two things in here are load-bearing and shouldn't be trimmed:
//
//  1. The overall/recent split is stated as two separate required questions.
//     A model given both slopes will otherwise average them into a single
//     verdict, which erases the exact situation this feature was built for:
//     on plan overall, but stalled for the last few weeks.
//  2. The benchmark guardrails. Unlike every other number in this app, the
//     peer-comparison figures are the model's and are never verified against
//     anything. So the prompt demands ranges rather than point estimates, and
//     forbids attributing a specific statistic to a named study unless the
//     model is genuinely confident — a fabricated citation next to the user's
//     real data is worse than no benchmark at all.
func progressCheckinPrompt(req ProgressCheckinRequest) string {
	var b strings.Builder

	b.WriteString("You are a weight-management coach reviewing one person's progress. Today's date is ")
	b.WriteString(req.CurrentDate)
	b.WriteString(".\n\n")

	fmt.Fprintf(&b, "The person is a %d-year-old %s, BMI category %q, %d weeks into their current plan. They started at %.1f lbs, weigh %.1f lbs today, and are aiming for %.1f lbs. Their plan expected them to be at %.1f lbs by now. They have lost %.1f%% of their starting body weight.\n\n",
		req.Age, req.Sex, req.BMICategory, req.WeeksIntoPlan,
		req.StartWeight, req.CurrentWeight, req.TargetWeight, req.ExpectedWeightNow, req.PctBodyWeightLost)

	fmt.Fprintf(&b, "Rate of change (positive = losing, negative = gaining), fitted by linear regression over daily weigh-ins:\n- Over their whole weigh-in history: %.2f lbs/week\n- Over just the last %d days: %.2f lbs/week\n- What the plan asks for: %.2f lbs/week\nThe app has already classified this pattern as %q.\n\n",
		req.OverallLbsPerWeek, req.RecentWindowDays, req.RecentLbsPerWeek, req.PlanLbsPerWeek, req.Pattern)

	fmt.Fprintf(&b, "Their daily targets are %d kcal and %d g protein.\n\n", req.CalorieTarget, req.ProteinTarget)

	b.WriteString("Here is the complete computed picture as JSON — food-logging and workout consistency over 7/28/90-day windows, the week-by-week actual-vs-target weight table, and their energy basis (BMR, maintenance calories, macro bands). Reason from these numbers; do not compute your own metabolic estimates and do not contradict any figure here:\n\n")
	b.WriteString(req.FactsJSON)
	b.WriteString("\n\n")

	b.WriteString("Answer TWO separate questions, and never merge them into one verdict:\n")
	b.WriteString("1. overall_assessment: how is the plan going across its whole span? Judge this against the overall rate and the cumulative result.\n")
	b.WriteString("2. recent_assessment: how do the last few weeks look ON THEIR OWN, compared to that overall trend? If the recent rate differs meaningfully from the overall rate — a slowdown, a stall, a regain, or an acceleration — say so plainly and lead with it. Someone who is on plan overall but has not moved in three weeks needs to hear about those three weeks, not be told they are doing fine.\n\n")

	b.WriteString("BENCHMARKS — the peer comparison. Return 3 to 5 benchmark rows placing this person against what people in a comparable situation typically experience. Good subjects: percentage of body weight lost by this point in a program; average weekly rate of loss; food-logging consistency; training frequency; and the prevalence and timing of plateaus. For each row give label, user_value (this person's actual figure, taken from the data above), typical_range (what is commonly seen, expressed as a RANGE), verdict (exactly one of \"ahead\", \"typical\", or \"behind\"), and context (one sentence on why that comparison is meaningful).\n")
	b.WriteString("Rules for these figures, and they matter: base them on the established weight-management literature (large lifestyle-intervention trials, self-monitoring research, weight-maintenance registries). Always give a range, never false precision. Do NOT attribute a specific number to a specific named study or year unless you are genuinely confident it is correct — write \"typically\" or \"commonly reported as\" instead. Never invent a citation, a percentage, or a sample size. If you are not confident about a benchmark, leave it out rather than guessing; three solid rows beat five shaky ones.\n\n")

	b.WriteString("Then return:\n")
	b.WriteString("- whats_working: 2 to 4 things this person is genuinely doing well, each grounded in a specific number from the data. Do not invent praise — if adherence is poor, say less here.\n")
	b.WriteString("- whats_slipping: 0 to 4 things that are working against them, again each tied to a specific number. Return an empty array if there is honestly nothing.\n")
	b.WriteString("- recommendations: 2 to 5 concrete changes, ordered most-impactful first. Each has a title (under 8 words), detail (what to actually do this week, specific and actionable), why_it_works (the mechanism or the evidence, one sentence), and effort (\"easy\", \"moderate\", or \"hard\"). If the recent trend has slowed or stalled, at least one recommendation must directly address getting back on pace.\n")
	b.WriteString("- what_works_generally: 2 to 4 things that reliably work for people in this situation regardless of this individual's data — the general playbook, clearly distinct from the personalized recommendations above.\n")
	b.WriteString("- headline: one sentence, under 15 words, capturing the whole verdict. When overall and recent disagree, the headline must convey both (e.g. \"On plan overall, but the last three weeks have stalled\").\n")
	b.WriteString("- outlook: two or three sentences on where this lands if the current trend holds, and what changes that.\n\n")

	b.WriteString("Tone: direct, warm, and honest. Do not soften a real problem into a compliment, and do not shame — this person is still logging, which is why you have data at all. No medical claims, no diagnosis, and no advice that would push intake below the plan's calorie floor or a loss rate above about 2 lbs/week. If the data suggests a medical cause or disordered pattern, note it gently and suggest speaking with a doctor. Write plain prose with no markdown syntax anywhere — no asterisks, no bullet characters, no headings, no backticks — the app supplies all formatting itself.")

	return b.String()
}

// progressCheckinJSONSchema is the JSON schema all three providers' structured
// output requests should target for GenerateProgressCheckin.
func progressCheckinJSONSchema() map[string]any {
	benchmarkSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"label":         map[string]any{"type": "string"},
			"user_value":    map[string]any{"type": "string"},
			"typical_range": map[string]any{"type": "string"},
			"verdict":       map[string]any{"type": "string", "enum": []string{"ahead", "typical", "behind"}},
			"context":       map[string]any{"type": "string"},
		},
		"required":             []string{"label", "user_value", "typical_range", "verdict", "context"},
		"additionalProperties": false,
	}
	pointSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title":  map[string]any{"type": "string"},
			"detail": map[string]any{"type": "string"},
		},
		"required":             []string{"title", "detail"},
		"additionalProperties": false,
	}
	recommendationSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title":        map[string]any{"type": "string"},
			"detail":       map[string]any{"type": "string"},
			"why_it_works": map[string]any{"type": "string"},
			"effort":       map[string]any{"type": "string", "enum": []string{"easy", "moderate", "hard"}},
		},
		"required":             []string{"title", "detail", "why_it_works", "effort"},
		"additionalProperties": false,
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"headline":             map[string]any{"type": "string"},
			"overall_assessment":   map[string]any{"type": "string"},
			"recent_assessment":    map[string]any{"type": "string"},
			"benchmarks":           map[string]any{"type": "array", "items": benchmarkSchema},
			"whats_working":        map[string]any{"type": "array", "items": pointSchema},
			"whats_slipping":       map[string]any{"type": "array", "items": pointSchema},
			"recommendations":      map[string]any{"type": "array", "items": recommendationSchema},
			"what_works_generally": map[string]any{"type": "array", "items": pointSchema},
			"outlook":              map[string]any{"type": "string"},
		},
		"required": []string{"headline", "overall_assessment", "recent_assessment", "benchmarks",
			"whats_working", "whats_slipping", "recommendations", "what_works_generally", "outlook"},
		"additionalProperties": false,
	}
}

// New selects and constructs the configured provider. It returns (nil, nil)
// — not an error — when VisionProvider is unset, since photo import is an
// optional feature and the rest of the app must keep working without it.
// It returns an error only when VisionProvider names a provider whose
// corresponding API key is missing, or names an unknown provider — callers
// should log this and continue running with a nil Provider (see main.go),
// not treat it as fatal.
func New(cfg Config) (Provider, error) {
	switch cfg.VisionProvider {
	case "":
		return nil, nil
	case "anthropic":
		if cfg.AnthropicAPIKey == "" {
			return nil, fmt.Errorf("VISION_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set")
		}
		return newAnthropicProvider(cfg.AnthropicAPIKey, cfg.AnthropicModel), nil
	case "openai":
		if cfg.OpenAIAPIKey == "" {
			return nil, fmt.Errorf("VISION_PROVIDER=openai but OPENAI_API_KEY is not set")
		}
		return newOpenAIProvider(cfg.OpenAIAPIKey, cfg.OpenAIModel), nil
	case "gemini":
		if cfg.GeminiAPIKey == "" {
			return nil, fmt.Errorf("VISION_PROVIDER=gemini but GEMINI_API_KEY is not set")
		}
		return newGeminiProvider(cfg.GeminiAPIKey, cfg.GeminiModel), nil
	default:
		return nil, fmt.Errorf("unknown VISION_PROVIDER %q (expected anthropic, openai, or gemini)", cfg.VisionProvider)
	}
}

// nutritionJSONSchema is the JSON schema all three providers' structured
// output requests should target — kept as a plain map so each provider's
// SDK can embed it in whatever shape its structured-output feature expects.
func nutritionJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name":         map[string]any{"type": "string"},
			"brand":        map[string]any{"type": "string"},
			"calories":     map[string]any{"type": "number"},
			"protein":      map[string]any{"type": "number"},
			"carbs":        map[string]any{"type": "number"},
			"fat":          map[string]any{"type": "number"},
			"fiber":        map[string]any{"type": "number"},
			"sugar":        map[string]any{"type": "number"},
			"sodium":       map[string]any{"type": "number"},
			"cholesterol":  map[string]any{"type": "number"},
			"serving_size": map[string]any{"type": "string"},
		},
		"required":             []string{"calories", "protein", "carbs", "fat"},
		"additionalProperties": false,
	}
}

// --- Blood pressure insight (#bloodPressure) ---------------------------------

// BPInsightRequest carries the fully-computed blood-pressure picture. Every
// threshold decision — the ACC/AHA category, the trend label, the capture
// nudges — has already been made deterministically in Go, so the model's job is
// interpretation only. It must never re-derive or contradict a category.
type BPInsightRequest struct {
	CurrentDate string
	Sex         string
	Age         int

	Avg7Sys, Avg7Dia   float64
	Avg30Sys, Avg30Dia float64
	Avg90Sys, Avg90Dia float64
	// Category is computed from the 30-day average, and is the label the user
	// is looking at while they read this report.
	Category      string
	CategoryLabel string
	WorstCategory string
	TrendLabel    string
	SysPer30d     float64
	DiaPer30d     float64

	ReadingsLast30     int
	DaysMeasuredLast30 int
	SysStdDev30        float64

	// Contributing-factor evidence, all from the user's own logs.
	CurrentWeightLbs   float64
	WeightChange30dLbs float64
	WeightChange90dLbs float64
	BMICategory        string
	WorkoutDaysLast30  int
	AvgSodiumMg        float64
	SodiumTargetMg     int
	DaysFoodLogged30   int

	FactsJSON string
}

// BPContributor is one factor the model believes bears on the readings, with
// the figure from the user's own data that supports it.
type BPContributor struct {
	Factor    string `json:"factor"`
	Direction string `json:"direction"` // "helping" | "hurting" | "unclear"
	Evidence  string `json:"evidence"`
	Strength  string `json:"strength"` // "strong" | "moderate" | "weak"
}

// BPActionStep is one concrete thing to do about an out-of-range average.
type BPActionStep struct {
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	WhyItWorks string `json:"why_it_works"`
	Effort     string `json:"effort"`  // "easy" | "moderate" | "hard"
	Horizon    string `json:"horizon"` // "this week" | "this month" | "ongoing"
}

// BPInsightReport is the written half of the blood-pressure page. Every field
// is optional at render time — the page shows all its computed facts with or
// without this.
type BPInsightReport struct {
	Headline        string          `json:"headline"`
	WhereYouStand   string          `json:"where_you_stand"`
	TrendReading    string          `json:"trend_reading"`
	Contributors    []BPContributor `json:"contributors"`
	ActionPlan      []BPActionStep  `json:"action_plan"`
	MeasurementTips []CheckinPoint  `json:"measurement_tips"`
	// SeeADoctor is empty unless something genuinely warrants escalation. It's a
	// dedicated field rather than a sentence buried in prose so the escalation
	// has a fixed, prominent slot the UI can always find.
	SeeADoctor string `json:"see_a_doctor"`
	Outlook    string `json:"outlook"`
}

// bpInsightPrompt builds the shared GenerateBPInsight prompt.
//
// The fencing here matters more than in most prompts. Blood pressure is the one
// place in this app where a confidently-worded wrong sentence could lead
// someone to do something harmful, so the prompt: (1) hands the model the
// app-computed category and forbids restating a different one, (2) requires
// every claimed contributing factor to cite a figure from the user's own data,
// (3) bars diagnosis and any mention of medication, and (4) reserves a single
// dedicated field for "talk to a doctor" so escalation can't get lost in prose.
func bpInsightPrompt(req BPInsightRequest) string {
	demographics := "unknown age and sex"
	if req.Age > 0 && req.Sex != "" {
		demographics = fmt.Sprintf("%d-year-old %s", req.Age, req.Sex)
	}
	// A zero average means sodium wasn't recorded, not that they ate none —
	// plenty of food entries carry no sodium figure at all. Reporting it as
	// "0 mg" would hand the model a false fact it is explicitly told to trust.
	sodium := "not enough sodium data logged to judge their intake — do not speculate about it"
	if req.DaysFoodLogged30 >= 5 && req.AvgSodiumMg > 0 {
		sodium = fmt.Sprintf("averaging %.0f mg sodium on the %d days they logged food (their target is %d mg)",
			req.AvgSodiumMg, req.DaysFoodLogged30, req.SodiumTargetMg)
	}

	return fmt.Sprintf(`You are reviewing a person's home blood-pressure readings alongside the rest of their health log. Today is %s. They are a %s.

THE APP HAS ALREADY DECIDED THESE. Do not recompute or contradict them:
- Their 30-day average is %.0f/%.0f mmHg, which the app classifies as "%s" using the ACC/AHA 2017 thresholds. Use that classification exactly.
- Their 7-day average is %.0f/%.0f and their 90-day average is %.0f/%.0f.
- The worst single measurement occasion in the window classified as "%s".
- The fitted trend is "%s": systolic %+.1f mmHg and diastolic %+.1f mmHg per 30 days.
- They measured on %d of the last 30 days, %d readings total, with a day-to-day systolic spread of %.1f mmHg.

THEIR OTHER LOGGED DATA:
- Currently %.1f lbs, %+.1f lbs over 30 days and %+.1f lbs over 90 days. BMI category: %s.
- Trained on %d of the last 30 days.
- %s

Write the review as JSON matching the schema. Requirements:

1. where_you_stand: explain in plain language what a %.0f/%.0f average means, using the app's classification. Two or three sentences.

2. trend_reading: whether the direction of travel is good, and over what span. If the trend is "stable", say so plainly rather than inventing movement.

3. contributors: 2 to 4 factors that plausibly bear on these readings. Every one MUST cite a specific figure from the data above or the JSON below. If the data does not support a link, mark direction "unclear" and say why. Phrase these as association, never causation — "your average fell over the same period you lost 9 lbs", not "losing weight lowered your blood pressure". One person's log cannot establish cause.

4. action_plan: 2 to 5 concrete steps, most impactful first. If the 30-day average is Elevated or worse, at least one step must directly target lowering it. Stay strictly inside the levers this app tracks: sodium, body weight, aerobic activity, alcohol, sleep, stress. NEVER suggest starting, stopping, changing, or timing any medication.

5. measurement_tips: 2 to 4 tips on when and how to measure. Prioritise the gaps in the nudges array of the JSON below. Draw on standard guidance: five minutes seated rest, feet flat, back supported, arm at heart level, no caffeine/exercise/smoking for 30 minutes beforehand, two readings a minute apart, the same arm each time, morning and evening.

6. see_a_doctor: if the worst category is "crisis", OPEN by stating that a reading above 180/120 warrants prompt medical attention and this app is no substitute for it. If any average is in the Stage 2 range, recommend discussing these readings with a clinician. Otherwise leave this an empty string.

7. outlook: one short paragraph on what to expect if they keep doing what they are doing.

HARD RULES:
- Never diagnose. Hypertension is diagnosed by a clinician from repeated in-office measurements; you are describing the category these home readings fall into, which is not the same thing.
- Never mention medication in any form.
- Never give a cardiovascular risk percentage, life-expectancy claim, or invented citation.
- Never invent a number. Every figure you state must appear in the data above or the JSON below.
- Plain prose, no markdown, no bullet characters. Speak to them as "you".

FULL DATA:
%s`,
		req.CurrentDate, demographics,
		req.Avg30Sys, req.Avg30Dia, req.CategoryLabel,
		req.Avg7Sys, req.Avg7Dia, req.Avg90Sys, req.Avg90Dia,
		req.WorstCategory,
		req.TrendLabel, req.SysPer30d, req.DiaPer30d,
		req.DaysMeasuredLast30, req.ReadingsLast30, req.SysStdDev30,
		req.CurrentWeightLbs, req.WeightChange30dLbs, req.WeightChange90dLbs, req.BMICategory,
		req.WorkoutDaysLast30,
		sodium,
		req.Avg30Sys, req.Avg30Dia,
		req.FactsJSON,
	)
}

// bpInsightJSONSchema is the structured-output schema every provider's
// GenerateBPInsight request targets.
func bpInsightJSONSchema() map[string]any {
	contributorSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"factor":    map[string]any{"type": "string"},
			"direction": map[string]any{"type": "string", "enum": []string{"helping", "hurting", "unclear"}},
			"evidence":  map[string]any{"type": "string"},
			"strength":  map[string]any{"type": "string", "enum": []string{"strong", "moderate", "weak"}},
		},
		"required":             []string{"factor", "direction", "evidence", "strength"},
		"additionalProperties": false,
	}
	actionSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title":        map[string]any{"type": "string"},
			"detail":       map[string]any{"type": "string"},
			"why_it_works": map[string]any{"type": "string"},
			"effort":       map[string]any{"type": "string", "enum": []string{"easy", "moderate", "hard"}},
			"horizon":      map[string]any{"type": "string", "enum": []string{"this week", "this month", "ongoing"}},
		},
		"required":             []string{"title", "detail", "why_it_works", "effort", "horizon"},
		"additionalProperties": false,
	}
	tipSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title":  map[string]any{"type": "string"},
			"detail": map[string]any{"type": "string"},
		},
		"required":             []string{"title", "detail"},
		"additionalProperties": false,
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"headline":         map[string]any{"type": "string"},
			"where_you_stand":  map[string]any{"type": "string"},
			"trend_reading":    map[string]any{"type": "string"},
			"contributors":     map[string]any{"type": "array", "items": contributorSchema},
			"action_plan":      map[string]any{"type": "array", "items": actionSchema},
			"measurement_tips": map[string]any{"type": "array", "items": tipSchema},
			"see_a_doctor":     map[string]any{"type": "string"},
			"outlook":          map[string]any{"type": "string"},
		},
		"required": []string{"headline", "where_you_stand", "trend_reading", "contributors",
			"action_plan", "measurement_tips", "see_a_doctor", "outlook"},
		"additionalProperties": false,
	}
}
