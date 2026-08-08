package controllers

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/vision"
)

// classifyPattern is what the check-in page says about a trend when no AI
// provider is configured, and what colours the headline when one is — so it
// gets a table test over every branch rather than being exercised only
// incidentally through the handler.
func TestClassifyPattern(t *testing.T) {
	cases := []struct {
		name                  string
		overall, recent, plan float64
		want                  string
	}{
		{"gaining faster than noise is a regain", 1.0, -0.5, 1.0, models.CheckinPatternRegaining},
		{"a small gain inside the noise band is a stall", 1.0, -0.1, 1.0, models.CheckinPatternStalled},
		{"flat is a stall", 1.0, 0.0, 1.0, models.CheckinPatternStalled},
		{"on plan overall but stalled recently reads as stalled", 1.2, 0.05, 1.0, models.CheckinPatternStalled},
		{"beating the plan's pace is ahead", 1.0, 1.5, 1.0, models.CheckinPatternAhead},
		{"faster than own history is accelerating", 0.8, 1.1, 1.5, models.CheckinPatternAccelerating},
		{"well down on own history is slowing", 1.5, 0.6, 1.5, models.CheckinPatternSlowing},
		{"steady but well short of the plan is slowing", 0.5, 0.5, 1.5, models.CheckinPatternSlowing},
		{"holding the plan's pace is steady", 1.0, 1.0, 1.0, models.CheckinPatternSteady},
		// A plan with no pace (target equals current weight) must not divide
		// the verdict by zero or read as "ahead" for any positive loss.
		{"no plan pace still classifies", 1.0, 1.0, 0, models.CheckinPatternSteady},
		// Turning a net gain around: there's no prior losing pace to be
		// "slower" than, so this must not read as slowing.
		{"recovering from a net gain is not slowing", -0.5, 0.8, 1.0, models.CheckinPatternSteady},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyPattern(tc.overall, tc.recent, tc.plan); got != tc.want {
				t.Fatalf("classifyPattern(%.2f, %.2f, %.2f) = %q, want %q",
					tc.overall, tc.recent, tc.plan, got, tc.want)
			}
		})
	}
}

func TestPlanPaceLbsPerWeek(t *testing.T) {
	// 230 -> 226 over 2 weeks = 2 lbs/week lost, reported positive.
	points := []models.WeightPlanProjectionPoint{
		{Week: 0, ExpectedWeight: 230},
		{Week: 1, ExpectedWeight: 228},
		{Week: 2, ExpectedWeight: 226},
	}
	if got := planPaceLbsPerWeek(points); got != 2 {
		t.Fatalf("expected 2 lbs/week, got %v", got)
	}
	if got := planPaceLbsPerWeek(points[:1]); got != 0 {
		t.Fatalf("a single point has no pace, got %v", got)
	}
	if got := planPaceLbsPerWeek(nil); got != 0 {
		t.Fatalf("no points has no pace, got %v", got)
	}
}

func TestForecastGoalDate(t *testing.T) {
	base := time.Date(2026, 8, 7, 0, 0, 0, 0, time.UTC)
	forecast := []models.WeightPlanProjectionPoint{
		{Week: 1, ExpectedWeight: 224, ExpectedDate: base.AddDate(0, 0, 7)},
		{Week: 2, ExpectedWeight: 220, ExpectedDate: base.AddDate(0, 0, 14)},
		{Week: 3, ExpectedWeight: 216, ExpectedDate: base.AddDate(0, 0, 21)},
	}

	got, ok := forecastGoalDate(forecast, 220, 228)
	if !ok || !got.Equal(base.AddDate(0, 0, 14)) {
		t.Fatalf("expected the first crossing point, got %v (ok=%v)", got, ok)
	}

	// A trend that never reaches the target must say so rather than inventing
	// a date — "your trend doesn't get there" is the finding.
	if _, ok := forecastGoalDate(forecast, 190, 228); ok {
		t.Fatal("expected no goal date when the forecast never reaches the target")
	}
	if _, ok := forecastGoalDate(nil, 190, 228); ok {
		t.Fatal("expected no goal date with no forecast")
	}
}

func TestRunWeightPlanCheckin_notFoundWithoutPlan(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPost, "/api/v1/weight/plan/checkin", nil)
	th.RunWeightPlanCheckin(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetLatestWeightPlanCheckin_notFoundBeforeFirstRun(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	acceptCheckinPlan(t, uid)

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/checkin", nil)
	th.GetLatestWeightPlanCheckin(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 before any check-in has been run, got %d: %s", w.Code, w.Body.String())
	}
}

// With no AI provider the check-in must still succeed and return every
// computed fact — only the narrative is optional. This is the self-hosted
// default (no API key), so it's the path most users hit.
func TestRunWeightPlanCheckin_succeedsWithoutVisionProvider(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	acceptCheckinPlan(t, uid)
	seedDecliningWeights(t, uid, 230, 0.5, 30)

	c, w := newContext(uid, http.MethodPost, "/api/v1/weight/plan/checkin", nil)
	th.RunWeightPlanCheckin(c) // th has a nil vision provider
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["report"] != nil {
		t.Fatalf("expected a null report with no provider configured, got %v", d["report"])
	}
	facts, ok := d["facts"].(map[string]any)
	if !ok {
		t.Fatalf("facts must be present even without a provider, got %v", d["facts"])
	}
	if facts["pattern"] == nil || facts["pattern"] == "" {
		t.Fatalf("expected a deterministic pattern verdict, got %v", facts["pattern"])
	}
	if _, ok := facts["adherence"].([]any); !ok {
		t.Fatalf("expected the adherence windows, got %v", facts["adherence"])
	}
}

// The facts are computed from the existing stores; this pins the numbers the
// whole report is grounded in, including the overall-vs-recent split.
func TestBuildCheckinFacts_composesJourneyAndRecentSignals(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	acceptCheckinPlan(t, uid)

	// Steady loss at 0.5 lbs/day, then flat for the whole 28-day recent window
	// (and a little beyond, so no decline leaks in) — the exact "on plan
	// overall, stalled for the last few weeks" shape this feature exists for.
	now := time.Now().UTC()
	weight := 260.0
	for i := 90; i > checkinRecentWindowDays+2; i-- {
		insertWeightLog(t, uid, weight, now.AddDate(0, 0, -i))
		weight -= 0.5
	}
	for i := checkinRecentWindowDays + 2; i >= 0; i-- {
		insertWeightLog(t, uid, weight, now.AddDate(0, 0, -i))
	}

	facts, goal, err := th.buildCheckinFacts(uid, now)
	if err != nil {
		t.Fatalf("buildCheckinFacts: %v", err)
	}
	if goal.CalorieTarget != 1800 {
		t.Fatalf("expected the accepted goal, got calorie_target %d", goal.CalorieTarget)
	}
	if facts.CurrentWeight != weight {
		t.Fatalf("expected current weight %.1f, got %.1f", weight, facts.CurrentWeight)
	}
	if facts.OverallLbsPerWeek <= 0.5 {
		t.Fatalf("expected a clearly positive overall pace, got %.2f", facts.OverallLbsPerWeek)
	}
	if facts.RecentLbsPerWeek > checkinStallLbsPerWeek {
		t.Fatalf("expected a flat recent pace after 20 static days, got %.2f", facts.RecentLbsPerWeek)
	}
	if facts.Pattern != models.CheckinPatternStalled {
		t.Fatalf("expected a %q verdict, got %q", models.CheckinPatternStalled, facts.Pattern)
	}
	if facts.RecentWindowDays != checkinRecentWindowDays {
		t.Fatalf("expected the recent window to be reported, got %d", facts.RecentWindowDays)
	}
	if len(facts.Adherence) != len(checkinAdherenceWindows) {
		t.Fatalf("expected %d adherence windows, got %d", len(checkinAdherenceWindows), len(facts.Adherence))
	}
	if facts.LostLbs <= 0 {
		t.Fatalf("expected a positive loss over the journey, got %.1f", facts.LostLbs)
	}
	if facts.PctBodyWeightLost <= 0 {
		t.Fatalf("expected a positive %% body weight lost, got %.1f", facts.PctBodyWeightLost)
	}
}

// Averaging calories over the whole window rather than over days that were
// actually logged would make under-logging read as restriction — the opposite
// of what's happening, and it would drive the wrong recommendation.
func TestBuildCheckinFacts_averagesCaloriesOverLoggedDaysOnly(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	acceptCheckinPlan(t, uid)
	seedDecliningWeights(t, uid, 230, 0.3, 10)

	// Two logged days at 2000 kcal inside a 7-day window.
	now := time.Now().UTC()
	insertFoodLog(t, uid, "meal", "dinner", 2000, 100, 100, 60, now.Truncate(time.Hour))
	insertFoodLog(t, uid, "meal", "dinner", 2000, 100, 100, 60, now.AddDate(0, 0, -1).Truncate(time.Hour))

	facts, _, err := th.buildCheckinFacts(uid, now)
	if err != nil {
		t.Fatalf("buildCheckinFacts: %v", err)
	}
	var week models.CheckinWindow
	for _, w := range facts.Adherence {
		if w.Days == 7 {
			week = w
		}
	}
	if week.FoodLoggedDays != 2 {
		t.Fatalf("expected 2 logged days, got %d", week.FoodLoggedDays)
	}
	if week.AvgCalories != 2000 {
		t.Fatalf("expected 2000 kcal averaged over logged days only, got %.0f", week.AvgCalories)
	}
}

// A gain/maintenance plan inverts what "behind" means. Same rule as the
// adherence endpoint — being lighter than planned is the wrong direction here.
func TestBuildCheckinFacts_invertsBehindForGainPlan(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	body := acceptPlanBody()
	body["target_weight"] = 180
	body["weekly_trajectory"] = []map[string]any{
		{"week": 0, "expected_weight": 160},
		{"week": 1, "expected_weight": 162},
		{"week": 2, "expected_weight": 164},
	}
	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", body)
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d: %s", aw.Code, aw.Body.String())
	}

	now := time.Now().UTC()
	insertWeightLog(t, uid, 155, now) // lighter than the week-0 expectation

	facts, _, err := th.buildCheckinFacts(uid, now)
	if err != nil {
		t.Fatalf("buildCheckinFacts: %v", err)
	}
	if !facts.BehindPlan {
		t.Fatal("expected behind_plan for a gain plan when the user is lighter than expected")
	}
	if facts.VarianceLbs < 0 {
		t.Fatalf("variance is a magnitude; expected non-negative, got %.1f", facts.VarianceLbs)
	}
}

// The check-in reports variance unsigned in BOTH directions — it's rendered
// directly beside "ahead of plan" / "behind plan", where a negative number
// would contradict the label. (The adherence endpoint deliberately differs.)
func TestBuildCheckinFacts_varianceIsUnsignedWhenAheadOfPlan(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	acceptCheckinPlan(t, uid) // week 0 expects 230, target 190

	now := time.Now().UTC()
	insertWeightLog(t, uid, 218, now) // lighter than planned = ahead

	facts, _, err := th.buildCheckinFacts(uid, now)
	if err != nil {
		t.Fatalf("buildCheckinFacts: %v", err)
	}
	if facts.BehindPlan {
		t.Fatal("expected ahead of plan when lighter than the projection on a loss plan")
	}
	if facts.VarianceLbs != 12 {
		t.Fatalf("expected an unsigned variance of 12, got %.1f", facts.VarianceLbs)
	}
}

// The report is a stored artifact: once generated it must read back byte-identical,
// so a user's check-in doesn't quietly change under them between visits.
func TestRunWeightPlanCheckin_persistsReportAndReadsBack(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	acceptCheckinPlan(t, uid)
	seedDecliningWeights(t, uid, 230, 0.4, 20)

	fake := &fakeVisionProvider{checkinReport: vision.ProgressCheckinReport{
		Headline:          "On plan overall, but the last three weeks have stalled",
		OverallAssessment: "overall text",
		RecentAssessment:  "recent text",
		Benchmarks: []vision.CheckinBenchmark{{
			Label: "Body weight lost", UserValue: "6%", TypicalRange: "3-8%",
			Verdict: "typical", Context: "context",
		}},
		WhatsWorking:       []vision.CheckinPoint{{Title: "Consistent logging", Detail: "detail"}},
		WhatsSlipping:      []vision.CheckinPoint{{Title: "Weekend calories", Detail: "detail"}},
		Recommendations:    []vision.CheckinRecommendation{{Title: "Tighten weekends", Detail: "d", WhyItWorks: "w", Effort: "easy"}},
		WhatWorksGenerally: []vision.CheckinPoint{{Title: "Self-monitoring", Detail: "detail"}},
		Outlook:            "outlook text",
	}}
	h := NewHandler(stores.New(db.DB), fake)

	c, w := newContext(uid, http.MethodPost, "/api/v1/weight/plan/checkin", nil)
	h.RunWeightPlanCheckin(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// The prompt must receive the deterministic verdict and the full facts blob.
	if fake.checkinReq.Pattern == "" {
		t.Fatal("expected the computed pattern to be threaded into the prompt")
	}
	if fake.checkinReq.FactsJSON == "" {
		t.Fatal("expected the facts JSON to be threaded into the prompt")
	}

	// Reading back must return the stored report, not regenerate it.
	fake.checkinReport = vision.ProgressCheckinReport{Headline: "a different report"}
	gc, gw := newContext(uid, http.MethodGet, "/api/v1/weight/plan/checkin", nil)
	h.GetLatestWeightPlanCheckin(gc)
	if gw.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", gw.Code, gw.Body.String())
	}
	d := settingsData(t, gw)
	report, ok := d["report"].(map[string]any)
	if !ok {
		t.Fatalf("expected a stored report, got %v", d["report"])
	}
	if report["headline"] != "On plan overall, but the last three weeks have stalled" {
		t.Fatalf("GET must return the stored report verbatim, got %v", report["headline"])
	}
	if recs, ok := report["recommendations"].([]any); !ok || len(recs) != 1 {
		t.Fatalf("expected the recommendations to round-trip, got %v", report["recommendations"])
	}
}

// A provider failure must not lose the user's facts — they waited for the run,
// and every number on the page is computed locally anyway.
func TestRunWeightPlanCheckin_storesFactsWhenProviderFails(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	acceptCheckinPlan(t, uid)
	seedDecliningWeights(t, uid, 230, 0.4, 10)

	h := NewHandler(stores.New(db.DB), &fakeVisionProvider{
		checkinErr: errProviderDown,
	})

	c, w := newContext(uid, http.MethodPost, "/api/v1/weight/plan/checkin", nil)
	h.RunWeightPlanCheckin(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 despite the provider failing, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["report"] != nil {
		t.Fatalf("expected a null report after a provider failure, got %v", d["report"])
	}
	if _, ok := d["facts"].(map[string]any); !ok {
		t.Fatalf("facts must survive a provider failure, got %v", d["facts"])
	}
}

// --- helpers ---------------------------------------------------------------

var errProviderDown = errors.New("provider down")

func acceptCheckinPlan(t *testing.T, uid int64) {
	t.Helper()
	c, w := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("accept plan: expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

// seedDecliningWeights writes one weigh-in per day for `days` days ending
// today, dropping by perDay lbs each day.
func seedDecliningWeights(t *testing.T, uid int64, start, perDay float64, days int) {
	t.Helper()
	now := time.Now().UTC()
	for i := days; i >= 0; i-- {
		insertWeightLog(t, uid, start-perDay*float64(days-i), now.AddDate(0, 0, -i))
	}
}
