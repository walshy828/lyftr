package controllers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/Cawlumm/lyftr-backend/vision"
	"github.com/gin-gonic/gin"
)

// GenerateWeightPlan proposes daily nutrition targets and a weekly weight
// trajectory toward the requested target weight, via the same configured
// vision/AI provider as the other AI endpoints. Like GenerateProgram/
// RecommendMeals, the result is always a suggestion — nothing is written
// here; the frontend reviews it and calls AcceptWeightPlan to persist.
func (h *Handler) GenerateWeightPlan(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.GenerateWeightPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if h.vision == nil {
		utils.ServiceUnavailable(c, "AI weight-loss plan builder is not configured on this server")
		return
	}

	profile, err := h.s.Profile.Get(uid)
	if err == sql.ErrNoRows {
		profile = models.DefaultUserProfile(uid)
	} else if utils.DBError(c, err) {
		return
	}
	if profile.HeightInches <= 0 {
		utils.BadRequest(c, "set your height, birth date, and sex in your profile before generating a plan")
		return
	}
	age, ok := utils.AgeFromBirthDate(profile.BirthDate, time.Now())
	if !ok {
		utils.BadRequest(c, "set your birth date in your profile before generating a plan")
		return
	}

	stats, err := h.s.Weight.Stats(uid)
	if utils.DBError(c, err) {
		return
	}
	if stats.Latest <= 0 {
		utils.BadRequest(c, "log at least one weight entry before generating a plan")
		return
	}

	low, high := utils.HealthyWeightRangeLbs(profile.HeightInches)
	bmiCategory := utils.BMICategory(utils.BMI(stats.Latest, profile.HeightInches))
	pace := utils.WeeklyLossGuidanceFor(bmiCategory, stats.Latest)

	// 60s, not 20s: this prompt asks for a full weekly trajectory alongside
	// macro targets and runs longer than the shorter single-item AI endpoints
	// — same rationale as GenerateProgram/RecommendMeals.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	plan, err := h.vision.GenerateWeightPlan(ctx, vision.GenerateWeightPlanRequest{
		Age:                    age,
		Sex:                    profile.Sex,
		ActivityLevel:          profile.ActivityLevel,
		HeightInches:           profile.HeightInches,
		CurrentWeight:          stats.Latest,
		TargetWeight:           req.TargetWeight,
		TimeframeWeeks:         req.TimeframeWeeks,
		HealthyRangeLow:        low,
		HealthyRangeHigh:       high,
		BMICategory:            bmiCategory,
		SustainedLossLowPerWk:  pace.LowLbsPerWeek,
		SustainedLossHighPerWk: pace.HighLbsPerWeek,
	})
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			utils.ServiceUnavailable(c, "plan generation timed out — try again")
			return
		}
		log.Printf("[weight/plan/generate] vision error: %v", err)
		utils.ServiceUnavailable(c, fmt.Sprintf("could not generate a plan — try again (%s)", truncateErr(err)))
		return
	}
	utils.OK(c, plan)
}

// AcceptWeightPlan persists a (possibly user-edited) reviewed draft: inserts
// the nutrition-goal history row + its weekly projections, and imports the
// four macro targets into user_settings, all atomically via
// NutritionGoalStore.Accept.
func (h *Handler) AcceptWeightPlan(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.AcceptWeightPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	now := time.Now().UTC()
	goal := models.NutritionGoal{
		CalorieTarget: req.CalorieTarget,
		ProteinTarget: req.ProteinTarget,
		CarbTarget:    req.CarbTarget,
		FatTarget:     req.FatTarget,
		TargetWeight:  req.TargetWeight,
		Source:        "ai",
		Notes:         req.Notes,
	}
	projections := make([]models.WeightPlanProjectionPoint, len(req.WeeklyTrajectory))
	for i, w := range req.WeeklyTrajectory {
		projections[i] = models.WeightPlanProjectionPoint{
			Week:           w.Week,
			ExpectedWeight: w.ExpectedWeight,
			ExpectedDate:   now.AddDate(0, 0, w.Week*7),
		}
	}

	saved, err := h.s.NutritionGoal.Accept(uid, goal, projections)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, saved)
}

// GetCurrentNutritionGoal returns the user's latest accepted plan plus its
// weekly projections in one response, so the frontend can render
// actual-vs-plan without a second round trip. It also attaches plan_timeline
// (the "Plan" line stitched across every goal the user has ever accepted,
// each clipped to the window it was active for — see
// NutritionGoalStore.Timeline) and actual_forecast (a clamped linear
// projection of where the user's real weight trend is headed, see
// utils.ForecastActualWeight), so the chart and regenerate-prompt logic both
// have everything they need in this one round trip.
func (h *Handler) GetCurrentNutritionGoal(c *gin.Context) {
	uid := middleware.UserID(c)
	goal, err := h.s.NutritionGoal.Current(uid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "no weight-loss plan yet")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	projections, err := h.s.NutritionGoal.ListProjections(goal.ID)
	if utils.DBError(c, err) {
		return
	}
	timeline, err := h.s.NutritionGoal.Timeline(uid)
	if utils.DBError(c, err) {
		return
	}
	forecast, err := h.forecastActualWeight(uid, timeline)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{
		"goal":            goal,
		"projections":     projections,
		"plan_timeline":   timeline,
		"actual_forecast": forecast,
	})
}

// forecastActualWeight fetches the user's weight logs and BMI-based pace
// guidance and hands them to utils.ForecastActualWeight, projecting out to
// the end of the given plan timeline (or a fixed fallback horizon if the
// user has no plan/timeline yet). Shared by GetCurrentNutritionGoal and
// GetWeightPlanAdherence so both derive should-regenerate/forecast signals
// from the same computation.
func (h *Handler) forecastActualWeight(uid int64, timeline []models.WeightPlanProjectionPoint) ([]models.WeightPlanProjectionPoint, error) {
	logs, err := h.s.Weight.List(uid, stores.WeightFilter{Limit: 200})
	if err != nil {
		return nil, err
	}

	profile, err := h.s.Profile.Get(uid)
	if err == sql.ErrNoRows {
		profile = models.DefaultUserProfile(uid)
	} else if err != nil {
		return nil, err
	}

	stats, err := h.s.Weight.Stats(uid)
	if err != nil {
		return nil, err
	}
	var guidance models.WeeklyLossGuidance
	if profile.HeightInches > 0 && stats.Latest > 0 {
		category := utils.BMICategory(utils.BMI(stats.Latest, profile.HeightInches))
		guidance = utils.WeeklyLossGuidanceFor(category, stats.Latest)
	}

	now := time.Now().UTC()
	horizonEnd := now.AddDate(0, 0, 56) // 8-week fallback horizon
	if len(timeline) > 0 {
		horizonEnd = timeline[len(timeline)-1].ExpectedDate
	}

	return utils.ForecastActualWeight(logs, guidance, horizonEnd), nil
}

// GetNutritionGoalHistory returns the user's nutrition-goal history,
// most-recent first, so they can see how their targets changed over time.
func (h *Handler) GetNutritionGoalHistory(c *gin.Context) {
	uid := middleware.UserID(c)
	goals, err := h.s.NutritionGoal.List(uid, 50)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, goals)
}

// adherenceLookbackDays is the rolling window used for the logging/workout
// consistency signals in the adherence panel. It's a trailing window that
// includes today (see stores.dayWindow), not a calendar week, so it's always
// "full" — there's no partial-period case to correct for here, and the counts
// it produces are bounded by it.
const adherenceLookbackDays = 7

// weekStart returns the Monday (UTC, midnight) of the week containing t —
// used to key the motivation-note cache so at most one AI call happens per
// user per calendar week.
func weekStart(t time.Time) time.Time {
	t = t.UTC()
	// time.Weekday: Sunday=0 ... Saturday=6. Days since Monday.
	offset := (int(t.Weekday()) + 6) % 7
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return d.AddDate(0, 0, -offset)
}

// nearestProjection returns the projection whose week is closest to (but not
// after) weeksSince, or the last projection if weeksSince exceeds them all.
func nearestProjection(points []models.WeightPlanProjectionPoint, weeksSince int) (models.WeightPlanProjectionPoint, bool) {
	if len(points) == 0 {
		return models.WeightPlanProjectionPoint{}, false
	}
	best := points[0]
	for _, p := range points {
		if p.Week <= weeksSince && p.Week >= best.Week {
			best = p
		}
	}
	return best, true
}

// GetWeightPlanAdherence composes existing store data (no new tables beyond
// nutrition_goals/weight_plan_projections/motivation_notes) into a
// deterministic on-track/behind verdict, rule-based "what's driving it"
// callouts, and the current week's cached (or freshly generated) AI
// motivational note.
func (h *Handler) GetWeightPlanAdherence(c *gin.Context) {
	uid := middleware.UserID(c)

	goal, err := h.s.NutritionGoal.Current(uid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "no weight-loss plan yet")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	projections, err := h.s.NutritionGoal.ListProjections(goal.ID)
	if utils.DBError(c, err) {
		return
	}

	weightStats, err := h.s.Weight.Stats(uid)
	if utils.DBError(c, err) {
		return
	}

	now := time.Now().UTC()
	weeksIntoPlan := int(now.Sub(goal.EffectiveAt).Hours() / (24 * 7))
	if weeksIntoPlan < 0 {
		weeksIntoPlan = 0
	}
	expected, hasExpected := nearestProjection(projections, weeksIntoPlan)

	variance := 0.0
	behindPlan := false
	if hasExpected && weightStats.Latest > 0 {
		variance = weightStats.Latest - expected.ExpectedWeight
		// Losing-weight plans: behind if actual is heavier than expected.
		// Gaining/maintenance plans (target above starting weight) invert the sign.
		if goal.TargetWeight < expected.ExpectedWeight {
			behindPlan = variance > 0
		} else {
			behindPlan = variance < 0
			variance = -variance
		}
	}

	loggedDays, err := h.s.Food.LoggedDaysCount(uid, adherenceLookbackDays)
	if utils.DBError(c, err) {
		return
	}
	history, err := h.s.Food.History(uid, adherenceLookbackDays)
	if utils.DBError(c, err) {
		return
	}
	workoutDays, err := h.s.Workout.CountSince(uid, adherenceLookbackDays)
	if utils.DBError(c, err) {
		return
	}

	var totalCalories float64
	for _, p := range history {
		totalCalories += p.Calories
	}
	avgCalories := 0.0
	if loggedDays > 0 {
		avgCalories = totalCalories / float64(loggedDays)
	}

	drivers := []string{}
	if loggedDays < adherenceLookbackDays-2 {
		drivers = append(drivers, fmt.Sprintf("logged food only %d of the last %d days", loggedDays, adherenceLookbackDays))
	}
	if loggedDays > 0 && goal.CalorieTarget > 0 && avgCalories > float64(goal.CalorieTarget)+150 {
		drivers = append(drivers, fmt.Sprintf("averaging about %.0f kcal/day, %.0f over your target", avgCalories, avgCalories-float64(goal.CalorieTarget)))
	}
	if workoutDays == 0 {
		drivers = append(drivers, fmt.Sprintf("no workouts logged in the last %d days", adherenceLookbackDays))
	}

	forceRefresh := c.Query("refresh") == "1"
	note := h.currentMotivationNote(c.Request.Context(), uid, now, behindPlan, variance, drivers, weeksIntoPlan, forceRefresh)

	forecast, err := h.forecastActualWeight(uid, projections)
	if utils.DBError(c, err) {
		return
	}
	shouldRegenerate, regenerateReason := planRegenerateSignal(goal, projections, forecast, now)

	utils.OK(c, gin.H{
		"behind_plan":       behindPlan,
		"variance_lbs":      variance,
		"drivers":           drivers,
		"motivational_note": note,
		"days_logged_food":  loggedDays,
		"logging_window":    adherenceLookbackDays,
		"avg_calories":      avgCalories,
		"workouts_last_7d":  workoutDays,
		"weeks_into_plan":   weeksIntoPlan,
		"should_regenerate": shouldRegenerate,
		"regenerate_reason": regenerateReason,
	})
}

// planRegenerateStaleTargetLbs is how far the actual-weight forecast's
// end-of-plan projection may diverge from the plan's target weight before
// prompting the user to regenerate — small day-to-day variance is expected
// and shouldn't trigger this, only a sustained trend that won't get there.
const planRegenerateStaleTargetLbs = 5.0

// planRegenerateSignal decides whether the current plan is stale enough to
// prompt the user to regenerate it: either the plan's own timeline has run
// out, or the actual-weight trend (already clamped/smoothed by
// utils.ForecastActualWeight, so a single noisy week can't trigger this) is
// projected to miss the target by more than planRegenerateStaleTargetLbs at
// the plan's final projection date.
func planRegenerateSignal(goal models.NutritionGoal, projections, forecast []models.WeightPlanProjectionPoint, now time.Time) (bool, string) {
	if len(projections) == 0 {
		return false, ""
	}
	last := projections[len(projections)-1]
	if now.After(last.ExpectedDate) {
		return true, fmt.Sprintf("Your plan's projections ended on %s — generate a new plan to keep your targets current.", last.ExpectedDate.Format("Jan 2, 2006"))
	}
	if len(forecast) == 0 {
		return false, ""
	}
	// Find the forecast point nearest the plan's final projection date.
	var atPlanEnd models.WeightPlanProjectionPoint
	found := false
	for _, f := range forecast {
		if !f.ExpectedDate.After(last.ExpectedDate) {
			atPlanEnd = f
			found = true
		}
	}
	if !found {
		atPlanEnd = forecast[len(forecast)-1]
	}
	diff := atPlanEnd.ExpectedWeight - goal.TargetWeight
	if diff < 0 {
		diff = -diff
	}
	if diff > planRegenerateStaleTargetLbs {
		return true, fmt.Sprintf("Your recent trend suggests you won't reach your target weight by %s — consider regenerating your plan.", last.ExpectedDate.Format("Jan 2, 2006"))
	}
	return false, ""
}

// canned rule-based fallback messages, used when no AI provider is
// configured or a fresh AI note can't be generated — the adherence panel
// must still show something encouraging either way.
var cannedMotivationOnTrack = "You're right on track — keep the consistency going, it's what gets results."
var cannedMotivationBehind = "Progress isn't always linear. Refocus on logging consistently this week and the trend will follow."

// currentMotivationNote returns the cached note for this calendar week,
// generating (and caching) a fresh one via AI at most once per user per
// week — unless forceRefresh is set (the adherence panel's manual refresh
// button), which always calls the AI and overwrites the week's cached note.
// Falls back to a canned message if AI isn't configured or the call fails —
// the adherence panel always has something to show.
func (h *Handler) currentMotivationNote(ctx context.Context, uid int64, now time.Time, behindPlan bool, variance float64, drivers []string, weeksIntoPlan int, forceRefresh bool) string {
	ws := weekStart(now)
	if !forceRefresh {
		if cached, err := h.s.Motivation.CurrentForWeek(uid, ws); err == nil {
			return cached.Message
		}
	}

	fallback := cannedMotivationOnTrack
	if behindPlan {
		fallback = cannedMotivationBehind
	}
	if h.vision == nil {
		return fallback
	}

	genCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	message, err := h.vision.GenerateMotivationNote(genCtx, vision.MotivationNoteRequest{
		CurrentDate:   now.Format("2006-01-02"),
		BehindPlan:    behindPlan,
		VarianceLbs:   variance,
		Drivers:       drivers,
		WeeksIntoPlan: weeksIntoPlan,
	})
	if err != nil {
		log.Printf("[weight/plan/adherence] motivation note vision error: %v", err)
		return fallback
	}
	if _, err := h.s.Motivation.Upsert(uid, ws, message); err != nil {
		log.Printf("[weight/plan/adherence] cache motivation note: %v", err)
	}
	return message
}
