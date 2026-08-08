package controllers

import (
	"context"
	"database/sql"
	"encoding/json"
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

// The progress check-in (#planCheckin).
//
// GetWeightPlanAdherence already answers "am I on the plan's line today?" over
// a 7-day window. This answers the coaching question instead: how is the whole
// journey going, how do the last few weeks compare to that, how does any of it
// stack up against what people in the same situation typically see, and what
// should change. It's a separate endpoint rather than more fields on adherence
// because it is user-triggered, slow, and costs an AI call — the dashboard
// must never trip it.
//
// Everything the report is grounded in is computed here from the existing
// stores (no new SQL, no new signals) and persisted alongside the narrative,
// so a stored check-in re-renders identically and the page still has a full
// readout on a server with no AI provider configured.

const (
	// checkinRecentWindowDays is the "how are the last few weeks going?"
	// window. Matches the forecast lookback (utils.forecastLookbackDays): long
	// enough that one bad weekend doesn't read as a stall, short enough to
	// surface a real three-week slowdown while it's still fixable.
	checkinRecentWindowDays = 28

	// checkinWeightLogLimit bounds the weight history loaded for the two
	// regressions. Daily weigh-ins for two years fit inside this.
	checkinWeightLogLimit = 800

	// checkinMaxWeeklyRows caps the week-by-week variance table carried into
	// the prompt. A year of weeks is plenty of context; beyond that it's just
	// tokens, and the oldest weeks are the least actionable.
	checkinMaxWeeklyRows = 52

	// checkinGenerateTimeout matches GenerateWeightPlan: this prompt asks for
	// two assessments, benchmarks, and three lists, and runs long.
	checkinGenerateTimeout = 60 * time.Second
)

// checkinAdherenceWindows are the rolling windows reported side by side. The
// contrast is the point: "6/7 days this week but 22/90 overall" and "28/28
// overall but 2/7 this week" are opposite problems that a single window can't
// tell apart.
var checkinAdherenceWindows = []int{7, 28, 90}

// Pattern-classification thresholds. Named because each encodes a judgment
// call about what counts as signal in a bodyweight series, not just a number.
const (
	// checkinStallLbsPerWeek is the band around zero that counts as "not
	// moving". Day-to-day bodyweight swings several pounds on water alone, so
	// a fitted trend inside this is noise, not progress or regain.
	checkinStallLbsPerWeek = 0.15
	// checkinAheadRatio is how far above the plan's own required pace the
	// recent trend has to sit before it's "ahead" rather than on pace.
	checkinAheadRatio = 1.15
	// checkinAccelRatio / checkinSlowdownRatio are measured against the user's
	// OWN overall pace, not the plan's — the question they answer is "has this
	// person changed?", which is what makes the recent-vs-overall split useful.
	checkinAccelRatio    = 1.25
	checkinSlowdownRatio = 0.6
	// checkinBehindPaceRatio catches a recent pace that is steady against the
	// user's own history but well short of what the plan actually needs.
	checkinBehindPaceRatio = 0.6
)

// classifyPattern reduces the overall pace, the recent pace, and the plan's
// required pace to a single trend label. All three are in pounds LOST per week
// (negative = gaining), so every comparison here reads in one direction.
//
// This is deterministic and unit-tested on purpose: it drives the headline
// accent and the fallback verdict, so the page says something true about the
// trend even when no AI provider is configured. The AI is given the label but
// is not the one deciding it.
//
// Order matters. The zero-and-below cases are checked first because a stall or
// a regain is the finding — ratios against a pace of roughly zero are
// meaningless, and "40% slower than before" is a useless way to describe
// someone who has stopped losing entirely.
func classifyPattern(overall, recent, plan float64) string {
	switch {
	case recent <= -checkinStallLbsPerWeek:
		return models.CheckinPatternRegaining
	case recent < checkinStallLbsPerWeek:
		return models.CheckinPatternStalled
	}

	if plan > 0 && recent >= plan*checkinAheadRatio {
		return models.CheckinPatternAhead
	}
	// Only meaningful when there was a prior pace to accelerate away from.
	if overall >= checkinStallLbsPerWeek && recent >= overall*checkinAccelRatio {
		return models.CheckinPatternAccelerating
	}
	if overall >= checkinStallLbsPerWeek && recent <= overall*checkinSlowdownRatio {
		return models.CheckinPatternSlowing
	}
	if plan > 0 && recent <= plan*checkinBehindPaceRatio {
		return models.CheckinPatternSlowing
	}
	return models.CheckinPatternSteady
}

// buildCheckinFacts assembles the complete computed picture a check-in reports
// on. It composes existing stores and utils only — every number here is one
// the app already knows how to derive, gathered into one place.
//
// Returns sql.ErrNoRows when the user has no active plan.
func (h *Handler) buildCheckinFacts(uid int64, now time.Time) (models.CheckinFacts, models.NutritionGoal, error) {
	var facts models.CheckinFacts

	goal, err := h.s.NutritionGoal.Current(uid)
	if err != nil {
		return facts, goal, err
	}
	projections, err := h.s.NutritionGoal.ListProjections(goal.ID)
	if err != nil {
		return facts, goal, err
	}
	stats, err := h.s.Weight.Stats(uid)
	if err != nil {
		return facts, goal, err
	}
	logs, err := h.s.Weight.List(uid, stores.WeightFilter{Limit: checkinWeightLogLimit})
	if err != nil {
		return facts, goal, err
	}

	facts.GeneratedAt = now
	facts.WeeksIntoPlan = weeksSince(goal.EffectiveAt, now)
	facts.PlanStart = truncateDay(goal.EffectiveAt)
	facts.TargetWeight = goal.TargetWeight
	facts.CurrentWeight = stats.Latest
	if len(projections) > 0 {
		facts.PlanEnd = truncateDay(projections[len(projections)-1].ExpectedDate)
	}

	// The journey is the whole history of accepted plans, not just the current
	// one — regenerating a plan mid-way must not reset "how far have I come".
	journeyStart := facts.PlanStart
	if first, ferr := h.s.NutritionGoal.First(uid); ferr == nil {
		journeyStart = truncateDay(first.EffectiveAt)
	} else if ferr != sql.ErrNoRows {
		return facts, goal, ferr
	}
	facts.JourneyStart = journeyStart

	// Starting weight is the earliest weigh-in on record, deliberately matching
	// the window OverallLbsPerWeek is fitted over so "you've lost X" and "at Y
	// lbs/week" describe the same stretch of time. Anchoring it to the plan's
	// start date instead would report a loss of zero on the day a plan is
	// accepted, discarding everything the user had already achieved.
	facts.StartWeight = stats.Starting
	facts.LostLbs = round1(facts.StartWeight - facts.CurrentWeight)
	if facts.StartWeight > 0 {
		facts.PctBodyWeightLost = math.Round((facts.LostLbs/facts.StartWeight)*1000) / 10
	}

	// Where the plan says they should be today, and by how much they miss it.
	// BehindPlan carries the direction — inverted for a gain/maintenance plan,
	// where being lighter than planned is the wrong way — and VarianceLbs is
	// always the magnitude.
	//
	// Note this differs from GetWeightPlanAdherence, which reports a signed
	// variance for loss plans and leaves the client to Math.abs it. Signed
	// there, unsigned here: the check-in renders the number directly next to
	// the words "ahead of plan" / "behind plan", and "-11.7 lb ahead of plan"
	// is nonsense. The direction is already in BehindPlan.
	if expected, ok := nearestProjection(projections, facts.WeeksIntoPlan); ok && stats.Latest > 0 {
		facts.ExpectedWeightNow = round1(expected.ExpectedWeight)
		variance := stats.Latest - expected.ExpectedWeight
		if goal.TargetWeight < expected.ExpectedWeight {
			facts.BehindPlan = variance > 0
		} else {
			facts.BehindPlan = variance < 0
		}
		facts.VarianceLbs = round1(math.Abs(variance))
	}

	// The overall-vs-recent split this whole feature exists to expose.
	//
	// "Overall" spans the entire weigh-in record, not just since the current
	// plan started. Two reasons: a plan accepted today would otherwise have no
	// overall pace at all (the window would be a single day), and weigh-ins
	// predating the plan are still this person's real trend — which is exactly
	// what "how am I going overall?" is asking about. How the plan itself is
	// tracking is already reported separately, as the variance against its own
	// projected line.
	facts.RecentWindowDays = checkinRecentWindowDays
	if pace, _, ok := utils.PaceLbsPerWeek(logs, time.Time{}, now); ok {
		facts.OverallLbsPerWeek = round2(pace)
	}
	if pace, _, ok := utils.PaceLbsPerWeek(logs, now.AddDate(0, 0, -checkinRecentWindowDays), now); ok {
		facts.RecentLbsPerWeek = round2(pace)
	}
	facts.PlanLbsPerWeek = round2(planPaceLbsPerWeek(projections))
	facts.Pattern = classifyPattern(facts.OverallLbsPerWeek, facts.RecentLbsPerWeek, facts.PlanLbsPerWeek)

	// Where the user's own trend lands them, as opposed to where the plan says.
	forecast, err := h.forecastActualWeight(uid, projections)
	if err != nil {
		return facts, goal, err
	}
	if date, ok := forecastGoalDate(forecast, goal.TargetWeight, stats.Latest); ok {
		facts.ProjectedGoalDate = date
		if !facts.PlanEnd.IsZero() {
			facts.DaysVsPlanGoalDate = int(math.Round(date.Sub(facts.PlanEnd).Hours() / 24))
		}
	}

	// Logging/training consistency across several windows.
	facts.Adherence = make([]models.CheckinWindow, 0, len(checkinAdherenceWindows))
	for _, days := range checkinAdherenceWindows {
		w := models.CheckinWindow{
			Days:          days,
			CalorieTarget: goal.CalorieTarget,
			ProteinTarget: goal.ProteinTarget,
		}
		if w.FoodLoggedDays, err = h.s.Food.LoggedDaysCount(uid, days); err != nil {
			return facts, goal, err
		}
		if w.WorkoutDays, err = h.s.Workout.CountSince(uid, days); err != nil {
			return facts, goal, err
		}
		history, herr := h.s.Food.History(uid, days)
		if herr != nil {
			return facts, goal, herr
		}
		// Averaged over days with any food logged, not over the window — a
		// blank day is a missing measurement, not a zero-calorie day, and
		// averaging it in would make under-logging look like restriction.
		var calories, protein float64
		for _, p := range history {
			calories += p.Calories
			protein += p.Protein
		}
		if n := float64(len(history)); n > 0 {
			w.AvgCalories = math.Round(calories / n)
			w.AvgProtein = math.Round(protein / n)
		}
		facts.Adherence = append(facts.Adherence, w)
	}

	// The locked-in week-by-week record, from the same builder the progress
	// view uses — target from the frozen projections, actual from weight_logs.
	timeline, err := h.s.NutritionGoal.Timeline(uid)
	if err != nil {
		return facts, goal, err
	}
	weeks := buildHistoryWeeks(journeyStart, now, timeline, logs)
	if len(weeks) > checkinMaxWeeklyRows {
		weeks = weeks[len(weeks)-checkinMaxWeeklyRows:]
	}
	facts.WeeklyVariance = weeks

	// Profile-derived context. All optional: an incomplete profile costs the
	// report some nuance but must not stop it from running.
	profile, perr := h.s.Profile.Get(uid)
	if perr == sql.ErrNoRows {
		profile = models.DefaultUserProfile(uid)
	} else if perr != nil {
		return facts, goal, perr
	}
	facts.Profile = profile
	if profile.HeightInches > 0 && stats.Latest > 0 {
		bmi := utils.BMI(stats.Latest, profile.HeightInches)
		category := utils.BMICategory(bmi)
		low, high := utils.HealthyWeightRangeLbs(profile.HeightInches)
		facts.BMI = models.BMIResult{
			BMI:              round1(bmi),
			Category:         category,
			HealthyRangeLow:  round1(low),
			HealthyRangeHigh: round1(high),
			ObeseMinLbs:      round1(utils.WeightAtBMI(profile.HeightInches, 30)),
			LossGuidance:     utils.WeeklyLossGuidanceFor(category, stats.Latest),
		}
	}
	basis, berr := h.planEnergyBasis(uid, goal)
	if berr != nil {
		return facts, goal, berr
	}
	facts.Basis = basis

	return facts, goal, nil
}

// planPaceLbsPerWeek is the average pounds-per-week the plan's own projections
// ask for, positive when the plan loses weight — the same sign convention as
// utils.PaceLbsPerWeek so the two are directly comparable.
func planPaceLbsPerWeek(points []models.WeightPlanProjectionPoint) float64 {
	if len(points) < 2 {
		return 0
	}
	first, last := points[0], points[len(points)-1]
	weeks := last.Week - first.Week
	if weeks <= 0 {
		return 0
	}
	return (first.ExpectedWeight - last.ExpectedWeight) / float64(weeks)
}

// forecastGoalDate finds when the user's own (already pace-clamped) trend
// reaches the target weight. Returns false when the trend never gets there
// inside the forecast horizon — which is itself a finding, and one the report
// should be able to state rather than paper over with an invented date.
func forecastGoalDate(forecast []models.WeightPlanProjectionPoint, target, current float64) (time.Time, bool) {
	if len(forecast) == 0 || current <= 0 {
		return time.Time{}, false
	}
	losing := target < current
	for _, p := range forecast {
		if losing && p.ExpectedWeight <= target {
			return p.ExpectedDate, true
		}
		if !losing && p.ExpectedWeight >= target {
			return p.ExpectedDate, true
		}
	}
	return time.Time{}, false
}

// round2 rounds to two decimals — pace figures are fractions of a pound per
// week, where round1 would flatten a real difference between 0.44 and 0.35.
func round2(v float64) float64 { return math.Round(v*100) / 100 }

// RunWeightPlanCheckin computes a fresh check-in and persists it.
//
// This is the only endpoint in the app that a user explicitly triggers an AI
// call from, and it is deliberately a POST: the report is a stored artifact
// with a timestamp, not a view that recomputes on every load.
//
// With no AI provider configured it still succeeds, storing the computed facts
// with a null report — every number on the page is deterministic, and only the
// narrative is lost. Same principle as the adherence panel's canned fallback:
// a missing optional provider degrades the feature, it doesn't remove it.
func (h *Handler) RunWeightPlanCheckin(c *gin.Context) {
	uid := middleware.UserID(c)
	now := time.Now().UTC()

	facts, goal, err := h.buildCheckinFacts(uid, now)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "no weight-loss plan yet")
		return
	}
	if utils.DBError(c, err) {
		return
	}

	factsJSON, err := json.Marshal(facts)
	if err != nil {
		log.Printf("[weight/plan/checkin] marshal facts: %v", err)
		utils.ServiceUnavailable(c, "could not prepare your check-in — try again")
		return
	}

	reportJSON := ""
	if h.vision != nil {
		if report, ok := h.generateCheckinReport(c, facts, goal, string(factsJSON)); ok {
			b, merr := json.Marshal(report)
			if merr != nil {
				log.Printf("[weight/plan/checkin] marshal report: %v", merr)
			} else {
				reportJSON = string(b)
			}
		}
	}

	stored, err := h.s.Checkin.Insert(uid, goal.ID, string(factsJSON), reportJSON)
	if utils.DBError(c, err) {
		return
	}
	decodeCheckin(&stored)
	utils.OK(c, stored)
}

// generateCheckinReport calls the provider and converts its result into the
// models shape. A failure here is logged and swallowed: the facts are worth
// storing on their own, and a user who just waited a minute should get their
// numbers rather than an error page.
func (h *Handler) generateCheckinReport(c *gin.Context, facts models.CheckinFacts, goal models.NutritionGoal, factsJSON string) (models.CheckinReport, bool) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), checkinGenerateTimeout)
	defer cancel()

	age, _ := utils.AgeFromBirthDate(facts.Profile.BirthDate, facts.GeneratedAt)

	report, err := h.vision.GenerateProgressCheckin(ctx, vision.ProgressCheckinRequest{
		CurrentDate:       facts.GeneratedAt.Format("2006-01-02"),
		Sex:               facts.Profile.Sex,
		Age:               age,
		WeeksIntoPlan:     facts.WeeksIntoPlan,
		StartWeight:       facts.StartWeight,
		CurrentWeight:     facts.CurrentWeight,
		TargetWeight:      facts.TargetWeight,
		ExpectedWeightNow: facts.ExpectedWeightNow,
		PctBodyWeightLost: facts.PctBodyWeightLost,
		BMICategory:       facts.BMI.Category,
		OverallLbsPerWeek: facts.OverallLbsPerWeek,
		RecentLbsPerWeek:  facts.RecentLbsPerWeek,
		RecentWindowDays:  facts.RecentWindowDays,
		PlanLbsPerWeek:    facts.PlanLbsPerWeek,
		Pattern:           facts.Pattern,
		CalorieTarget:     goal.CalorieTarget,
		ProteinTarget:     goal.ProteinTarget,
		FactsJSON:         factsJSON,
	})
	if err != nil {
		log.Printf("[weight/plan/checkin] vision error: %v", err)
		return models.CheckinReport{}, false
	}

	out := models.CheckinReport{
		Headline:          report.Headline,
		OverallAssessment: report.OverallAssessment,
		RecentAssessment:  report.RecentAssessment,
		Outlook:           report.Outlook,
	}
	for _, b := range report.Benchmarks {
		out.Benchmarks = append(out.Benchmarks, models.CheckinBenchmark(b))
	}
	out.WhatsWorking = checkinPoints(report.WhatsWorking)
	out.WhatsSlipping = checkinPoints(report.WhatsSlipping)
	out.WhatWorksGenerally = checkinPoints(report.WhatWorksGenerally)
	for _, r := range report.Recommendations {
		out.Recommendations = append(out.Recommendations, models.CheckinRecommendation(r))
	}
	return out, true
}

func checkinPoints(in []vision.CheckinPoint) []models.CheckinPoint {
	out := make([]models.CheckinPoint, 0, len(in))
	for _, p := range in {
		out = append(out, models.CheckinPoint(p))
	}
	return out
}

// GetLatestWeightPlanCheckin returns the user's most recent stored check-in,
// or 404 if they've never run one. Reading never triggers generation — the
// user decides when to spend an AI call.
func (h *Handler) GetLatestWeightPlanCheckin(c *gin.Context) {
	uid := middleware.UserID(c)

	checkin, err := h.s.Checkin.Latest(uid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "no check-in yet")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	decodeCheckin(&checkin)
	utils.OK(c, checkin)
}

// decodeCheckin unpacks the stored JSON columns into the response fields. A
// blob that fails to decode is left nil rather than failing the request:
// stored reports outlive the struct they were written from, and an older
// unreadable one shouldn't break the page.
func decodeCheckin(c *models.PlanCheckin) {
	if c.FactsJSON != "" {
		var f models.CheckinFacts
		if err := json.Unmarshal([]byte(c.FactsJSON), &f); err != nil {
			log.Printf("[weight/plan/checkin] decode facts for checkin %d: %v", c.ID, err)
		} else {
			c.Facts = &f
		}
	}
	if c.ReportJSON != "" {
		var r models.CheckinReport
		if err := json.Unmarshal([]byte(c.ReportJSON), &r); err != nil {
			log.Printf("[weight/plan/checkin] decode report for checkin %d: %v", c.ID, err)
		} else {
			c.Report = &r
		}
	}
}

// Compile-time guard: the conversions in generateCheckinReport rely on the
// vision and models structs staying field-identical. If either side gains a
// field the other lacks, this stops compiling instead of silently dropping it.
var (
	_ = models.CheckinBenchmark(vision.CheckinBenchmark{})
	_ = models.CheckinPoint(vision.CheckinPoint{})
	_ = models.CheckinRecommendation(vision.CheckinRecommendation{})
)
