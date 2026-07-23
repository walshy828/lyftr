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

// weightPlanPrompt builds the shared GenerateWeightPlan prompt — one builder
// used by all three providers so their prompts can't drift apart. States the
// safety envelope explicitly so a good-faith model won't propose a crash diet.
func weightPlanPrompt(req GenerateWeightPlanRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Design a weight-loss nutrition plan for a %d-year-old %s, %.0f inches tall, currently weighing %.0f lbs, with a %s activity level. They want to reach %.0f lbs", req.Age, req.Sex, req.HeightInches, req.CurrentWeight, req.ActivityLevel, req.TargetWeight)
	if req.TimeframeWeeks > 0 {
		fmt.Fprintf(&b, " within about %d weeks", req.TimeframeWeeks)
	}
	b.WriteString(".\n\n")

	fmt.Fprintf(&b, "The generally recognized healthy weight range for this height is %.0f-%.0f lbs. If the requested target weight falls outside this range, propose a plan that instead targets the nearer edge of the healthy range, and explain this adjustment in safety_notes.\n\n", req.HealthyRangeLow, req.HealthyRangeHigh)

	b.WriteString("Safety constraints (do not violate these): the rate of loss must never exceed about 2 lbs per week (a slower, sustainable rate is preferred for smaller total losses); daily calorie_target must never go below 1500 for a male or 1200 for a female, regardless of how aggressive the timeframe request is. If a safe plan can't reach the target in the requested timeframe, extend the trajectory and say so in rationale rather than dropping calories further.\n\n")

	b.WriteString("Return: calorie_target (integer kcal/day), protein_target, carb_target, fat_target (integer grams/day, roughly consistent with the calorie target), weekly_trajectory (an array of {week, expected_weight} starting at week 0 with the user's current weight and continuing at a realistic weekly pace to the plan's final target weight — one entry per week), rationale (one short paragraph explaining the calorie/macro choices and the pace), and safety_notes (any caveats, including a target adjustment if you moved it toward the healthy range, or a recommendation to consult a doctor for large or rapid changes).")
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
		},
		"required":             []string{"calorie_target", "protein_target", "carb_target", "fat_target", "weekly_trajectory", "rationale"},
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
