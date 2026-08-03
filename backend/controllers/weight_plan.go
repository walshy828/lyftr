package controllers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
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

	// Built first with no calorie target so the deterministic energy figures
	// can go into the prompt — the model must reason from the same BMR,
	// maintenance, and macro bands the user will see beside its write-up.
	// Rebuilt below once the model has proposed a calorie target.
	basis := utils.BuildPlanEnergyBasis(profile, age, stats.Latest, req.TargetWeight, 0, pace)

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
		BMR:                    basis.BMR,
		MaintenanceCalories:    basis.MaintenanceCalories,
		CalorieFloor:           basis.CalorieFloor,
		ProteinLowGrams:        basis.Protein.LowGrams,
		ProteinHighGrams:       basis.Protein.HighGrams,
		FatLowGrams:            basis.Fat.LowGrams,
		FatHighGrams:           basis.Fat.HighGrams,
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
	// Rebuilt with the model's calorie target so every activity level can
	// report what that target actually implies at that level. Nothing here is
	// asked of the model: the user is about to commit to daily numbers, and
	// the arithmetic behind them should be reproducible.
	basis = utils.BuildPlanEnergyBasis(profile, age, stats.Latest, req.TargetWeight, plan.CalorieTarget, pace)
	utils.OK(c, weightPlanDraftResponse{DraftWeightPlan: plan, Basis: basis})
}

// weightPlanDraftResponse is the generated draft plus its deterministic
// energy basis. The draft is embedded rather than nested so its fields stay
// at the top level of the response exactly as before — `basis` is purely
// additive for clients that don't read it.
type weightPlanDraftResponse struct {
	vision.DraftWeightPlan
	Basis models.PlanEnergyBasis `json:"basis"`
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
	// Store the structured write-up as JSON, and backfill the flat Notes
	// column from it when the client didn't send prose — Notes stays the
	// plain-text form everything non-plan-page reads.
	if req.PlanDetail != nil && (req.PlanDetail.Summary != "" || len(req.PlanDetail.Sections) > 0) {
		encoded, err := json.Marshal(req.PlanDetail)
		if err != nil {
			utils.BadRequest(c, "invalid plan detail")
			return
		}
		goal.PlanDetailJSON = string(encoded)
		if goal.Notes == "" {
			goal.Notes = req.PlanDetail.FlattenNotes()
		}
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
	decodePlanDetail(&saved)
	utils.Created(c, saved)
}

// decodePlanDetail parses a goal's stored plan_detail JSON into its Detail
// field so the API serves the structured form. A row from before structured
// plan text existed (or one whose JSON somehow doesn't parse) simply keeps a
// nil Detail and the client falls back to rendering Notes — a malformed blob
// is never worth failing the whole request over.
func decodePlanDetail(g *models.NutritionGoal) {
	if g.PlanDetailJSON == "" {
		return
	}
	var d models.PlanDetail
	if err := json.Unmarshal([]byte(g.PlanDetailJSON), &d); err != nil {
		log.Printf("[weight/plan] goal %d has unparseable plan_detail: %v", g.ID, err)
		return
	}
	g.Detail = &d
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
	decodePlanDetail(&goal)

	// The original plan's projections, deliberately *unclipped* (unlike
	// Timeline, which cuts each superseded plan off at the next one's
	// effective_at). This is the "where the plan I first committed to said
	// I'd be" reference line — it only means anything if it keeps running
	// past the point where it was replaced.
	original := []models.WeightPlanProjectionPoint{}
	journeyStart := goal.EffectiveAt
	first, err := h.s.NutritionGoal.First(uid)
	if err != nil && err != sql.ErrNoRows {
		if utils.DBError(c, err) {
			return
		}
	} else if err == nil {
		journeyStart = first.EffectiveAt
		if first.ID != goal.ID {
			original, err = h.s.NutritionGoal.ListProjections(first.ID)
			if utils.DBError(c, err) {
				return
			}
		}
	}

	utils.OK(c, gin.H{
		"goal":            goal,
		"projections":     projections,
		"plan_timeline":   timeline,
		"actual_forecast": forecast,
		"original_plan":   original,
		"journey_start":   journeyStart,
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
	for i := range goals {
		decodePlanDetail(&goals[i])
	}
	utils.OK(c, goals)
}

// GetWeightPlanHistory returns the locked-in progress record: for every week
// from the chosen start date to today, what the plan in force that week said
// the user should weigh versus what they actually weighed, plus a per-plan
// summary of promised pace against achieved pace.
//
// Nothing here is stored separately. The target side comes from
// weight_plan_projections, frozen at the moment each plan was accepted and
// clipped by NutritionGoalStore.Timeline to the window that plan was actually
// in force; the actual side comes from weight_logs. That makes the history
// immutable by construction — regenerating a plan appends a new goal and can
// never rewrite an elapsed week, so no snapshot table or backfill is needed.
//
// The window starts at ?from=YYYY-MM-DD if given, else the user's remembered
// settings.plan_history_start, else the journey start (first accepted plan).
func (h *Handler) GetWeightPlanHistory(c *gin.Context) {
	uid := middleware.UserID(c)

	first, err := h.s.NutritionGoal.First(uid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "no weight-loss plan yet")
		return
	}
	if utils.DBError(c, err) {
		return
	}

	settings, err := h.s.User.GetSettings(uid)
	if err == sql.ErrNoRows {
		settings = models.DefaultUserSettings(uid)
	} else if utils.DBError(c, err) {
		return
	}

	journeyStart := truncateDay(first.EffectiveAt)
	from := journeyStart
	// Query param wins over the remembered setting, so a one-off look at a
	// different window doesn't have to overwrite the saved preference.
	for _, candidate := range []string{c.Query("from"), settings.PlanHistoryStart} {
		if candidate == "" {
			continue
		}
		parsed, perr := time.Parse("2006-01-02", candidate)
		if perr != nil {
			if candidate == c.Query("from") {
				utils.BadRequest(c, "from must be a YYYY-MM-DD date")
				return
			}
			continue
		}
		from = parsed.UTC()
		break
	}

	timeline, err := h.s.NutritionGoal.Timeline(uid)
	if utils.DBError(c, err) {
		return
	}
	logs, err := h.s.Weight.List(uid, stores.WeightFilter{Limit: 2000})
	if utils.DBError(c, err) {
		return
	}

	history := models.WeightPlanHistory{
		JourneyStart: journeyStart.Format("2006-01-02"),
		From:         from.Format("2006-01-02"),
		Weeks:        buildHistoryWeeks(from, time.Now().UTC(), timeline, logs),
	}
	currentID := int64(0)
	if cur, cerr := h.s.NutritionGoal.Current(uid); cerr == nil {
		currentID = cur.ID
	} else if cerr != sql.ErrNoRows && utils.DBError(c, cerr) {
		return
	}
	history.Segments = buildHistorySegments(history.Weeks, currentID)
	utils.OK(c, history)
}

// truncateDay drops the time-of-day, keeping UTC — history buckets are whole
// days, and plan effective_at values carry a wall-clock time that would
// otherwise offset every bucket boundary.
func truncateDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// buildHistoryWeeks walks 7-day buckets from `from` up to `now`, pairing each
// bucket with the plan target interpolated at its start date and the weight
// actually logged nearest that date. Buckets before the first projection or
// after the last are skipped on the target side (GoalID 0) rather than
// extrapolated — inventing a target outside any plan's span would misreport
// adherence for weeks no plan covered.
func buildHistoryWeeks(from, now time.Time, timeline []models.WeightPlanProjectionPoint, logs []models.WeightLog) []models.WeightPlanHistoryWeek {
	weeks := []models.WeightPlanHistoryWeek{}
	from = truncateDay(from)
	end := truncateDay(now)
	for i := 0; !from.AddDate(0, 0, i*7).After(end); i++ {
		day := from.AddDate(0, 0, i*7)
		w := models.WeightPlanHistoryWeek{
			WeekStart: day.Format("2006-01-02"),
			Week:      i,
		}
		if target, goalID, ok := interpolateTimelineAt(timeline, day); ok {
			w.TargetWeight = round1(target)
			w.GoalID = goalID
		}
		// A ±3 day tolerance: people don't weigh in on a fixed weekday, and a
		// bucket with no nearby log is better left empty than filled from a
		// reading two weeks away.
		if actual, ok := nearestLogWeight(logs, day, 3); ok {
			w.ActualWeight = round1(actual)
			w.HasActual = true
			if w.GoalID != 0 {
				w.VarianceLbs = round1(w.ActualWeight - w.TargetWeight)
			}
		}
		weeks = append(weeks, w)
	}
	// Trim trailing buckets that carry neither a target nor a weigh-in. Once
	// every plan's last projection has passed and the user hasn't logged
	// since, the remaining buckets up to today are pure empty rows — they say
	// nothing and push the real record off the screen.
	for len(weeks) > 0 {
		last := weeks[len(weeks)-1]
		if last.GoalID != 0 || last.HasActual {
			break
		}
		weeks = weeks[:len(weeks)-1]
	}
	return weeks
}

// interpolateTimelineAt returns the planned weight at an arbitrary date by
// linearly interpolating between the two surrounding projection points, plus
// the goal that owned the earlier point. Projections land on weekly dates
// that won't line up with an arbitrary user-chosen start date, so exact
// lookups would leave most buckets empty.
func interpolateTimelineAt(timeline []models.WeightPlanProjectionPoint, at time.Time) (float64, int64, bool) {
	if len(timeline) == 0 {
		return 0, 0, false
	}
	var prev *models.WeightPlanProjectionPoint
	for i := range timeline {
		p := timeline[i]
		pd := truncateDay(p.ExpectedDate)
		if pd.Equal(at) {
			return p.ExpectedWeight, p.NutritionGoalID, true
		}
		if pd.After(at) {
			if prev == nil {
				return 0, 0, false // before the plan began
			}
			prevDay := truncateDay(prev.ExpectedDate)
			span := pd.Sub(prevDay).Hours()
			if span <= 0 {
				return prev.ExpectedWeight, prev.NutritionGoalID, true
			}
			frac := at.Sub(prevDay).Hours() / span
			return prev.ExpectedWeight + (p.ExpectedWeight-prev.ExpectedWeight)*frac, prev.NutritionGoalID, true
		}
		prev = &timeline[i]
	}
	return 0, 0, false // past the end of every plan
}

// nearestLogWeight returns the weight logged closest to `day`, within
// toleranceDays. Logs arrive newest-first from the store; order doesn't
// matter here since every candidate is compared by absolute distance.
func nearestLogWeight(logs []models.WeightLog, day time.Time, toleranceDays int) (float64, bool) {
	bestDelta := time.Duration(toleranceDays+1) * 24 * time.Hour
	best := 0.0
	found := false
	for _, l := range logs {
		delta := truncateDay(l.LoggedAt).Sub(day)
		if delta < 0 {
			delta = -delta
		}
		if delta < bestDelta {
			bestDelta, best, found = delta, l.Weight, true
		}
	}
	return best, found
}

// buildHistorySegments collapses the weekly buckets into one row per plan:
// the pace that plan promised against the pace actually achieved while it was
// in force. This is the readout that makes "0.5 lbs/week actual against a
// 1.0 lbs/week target" visible. Segments need both endpoints on a side to
// report that side's pace, so a plan with a single bucket reports 0.
func buildHistorySegments(weeks []models.WeightPlanHistoryWeek, currentGoalID int64) []models.WeightPlanSegment {
	segments := []models.WeightPlanSegment{}
	for i := 0; i < len(weeks); {
		if weeks[i].GoalID == 0 {
			i++
			continue
		}
		goalID := weeks[i].GoalID
		j := i
		for j+1 < len(weeks) && weeks[j+1].GoalID == goalID {
			j++
		}
		start, end := weeks[i], weeks[j]
		seg := models.WeightPlanSegment{
			GoalID:      goalID,
			From:        start.WeekStart,
			To:          end.WeekStart,
			Weeks:       float64(end.Week - start.Week),
			StartWeight: start.TargetWeight,
			EndWeight:   end.TargetWeight,
			IsCurrent:   goalID == currentGoalID,
		}
		if seg.Weeks > 0 {
			seg.TargetLbsPerWeek = round1((start.TargetWeight - end.TargetWeight) / seg.Weeks)
			// Pace from the first and last buckets in this segment that
			// actually have a weigh-in, not the segment edges — otherwise a
			// missing log at either end silently reports a pace of 0.
			if a, b, ok := firstLastActual(weeks[i : j+1]); ok && b.Week > a.Week {
				seg.StartWeight, seg.EndWeight = start.TargetWeight, end.TargetWeight
				seg.ActualLbsPerWeek = round1((a.ActualWeight - b.ActualWeight) / float64(b.Week-a.Week))
			}
		}
		segments = append(segments, seg)
		i = j + 1
	}
	return segments
}

// firstLastActual returns the earliest and latest buckets in a segment that
// have a real weigh-in.
func firstLastActual(weeks []models.WeightPlanHistoryWeek) (models.WeightPlanHistoryWeek, models.WeightPlanHistoryWeek, bool) {
	var a, b models.WeightPlanHistoryWeek
	found := false
	for _, w := range weeks {
		if !w.HasActual {
			continue
		}
		if !found {
			a, found = w, true
		}
		b = w
	}
	return a, b, found
}

// round1 rounds to one decimal — every weight the history endpoint reports is
// a display value, and unrounded interpolation output is noise.
func round1(v float64) float64 { return math.Round(v*10) / 10 }

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
