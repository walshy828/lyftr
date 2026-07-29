package controllers

import (
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
)

func TestGenerateWeightPlan_serviceUnavailableWithoutVision(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPost, "/api/v1/weight/plan/generate", map[string]any{"target_weight": 190})
	th.GenerateWeightPlan(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", w.Code, w.Body.String())
	}
}

func acceptPlanBody() map[string]any {
	return map[string]any{
		"calorie_target": 1800,
		"protein_target": 160,
		"carb_target":    180,
		"fat_target":     55,
		"target_weight":  190,
		"notes":          "test plan",
		"weekly_trajectory": []map[string]any{
			{"week": 0, "expected_weight": 230},
			{"week": 1, "expected_weight": 228},
			{"week": 2, "expected_weight": 226},
		},
	}
}

func TestAcceptWeightPlan_persistsGoalProjectionsAndSettingsAtomically(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	// Goal + projections round-trip via GetCurrentNutritionGoal.
	gc, gw := newContext(uid, http.MethodGet, "/api/v1/weight/plan/current", nil)
	th.GetCurrentNutritionGoal(gc)
	if gw.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", gw.Code, gw.Body.String())
	}
	d := settingsData(t, gw)
	goal, ok := d["goal"].(map[string]any)
	if !ok {
		t.Fatalf("goal is not an object: %v", d["goal"])
	}
	assertNum(t, goal, "calorie_target", 1800)
	projections, ok := d["projections"].([]any)
	if !ok || len(projections) != 3 {
		t.Fatalf("expected 3 projections, got %v", d["projections"])
	}

	// Settings must reflect the imported macro targets.
	sc, sw := newContext(uid, http.MethodGet, "/api/v1/settings", nil)
	th.GetSettings(sc)
	sd := settingsData(t, sw)
	assertNum(t, sd, "calorie_target", 1800)
	assertNum(t, sd, "protein_target", 160)
	assertNum(t, sd, "carb_target", 180)
	assertNum(t, sd, "fat_target", 55)
}

func TestGetNutritionGoalHistory_mostRecentFirst(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	body := acceptPlanBody()
	c1, w1 := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", body)
	th.AcceptWeightPlan(c1)
	if w1.Code != http.StatusCreated {
		t.Fatalf("first accept: expected 201, got %d", w1.Code)
	}

	body2 := acceptPlanBody()
	body2["calorie_target"] = 1700
	c2, w2 := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", body2)
	th.AcceptWeightPlan(c2)
	if w2.Code != http.StatusCreated {
		t.Fatalf("second accept: expected 201, got %d", w2.Code)
	}

	hc, hw := newContext(uid, http.MethodGet, "/api/v1/weight/plan/goals", nil)
	th.GetNutritionGoalHistory(hc)
	if hw.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", hw.Code)
	}
	resp := decodeResponse(t, hw)
	goals, ok := resp["data"].([]any)
	if !ok || len(goals) != 2 {
		t.Fatalf("expected 2 goals in history, got %v", resp["data"])
	}
	latest, _ := goals[0].(map[string]any)
	assertNum(t, latest, "calorie_target", 1700)
}

func TestGetWeightPlanAdherence_notFoundWithoutPlan(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/adherence", nil)
	th.GetWeightPlanAdherence(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetWeightPlanAdherence_composesFoodWorkoutWeightSignals(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d", aw.Code)
	}

	// Log a weight entry heavier than expected (behind plan for a loss goal).
	wc, ww := newContext(uid, http.MethodPost, "/api/v1/weight", map[string]any{"weight": 232})
	th.LogWeight(wc)
	if ww.Code != http.StatusCreated {
		t.Fatalf("log weight: expected 201, got %d", ww.Code)
	}

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/adherence", nil)
	th.GetWeightPlanAdherence(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["motivational_note"] == nil || d["motivational_note"] == "" {
		t.Fatalf("expected a non-empty motivational_note fallback, got %v", d["motivational_note"])
	}
	drivers, ok := d["drivers"].([]any)
	if !ok {
		t.Fatalf("drivers is not an array: %v", d["drivers"])
	}
	// No food/workout logged at all -> both consistency drivers should fire.
	if len(drivers) < 2 {
		t.Fatalf("expected at least 2 drivers with no food/workout logged, got %v", drivers)
	}
}

// Regression: the adherence window used date('now','-7 days'), which spans
// EIGHT calendar days (that midnight through today) — so a user who logged
// every day saw "8/7 days logged", a count larger than its own denominator.
func TestGetWeightPlanAdherence_daysLoggedNeverExceedsWindow(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d", aw.Code)
	}

	// Food on each of the last 8 calendar days — one more than the window.
	now := time.Now().UTC()
	for i := 0; i < 8; i++ {
		insertFoodLog(t, uid, "oats", "breakfast", 300, 10, 50, 5,
			now.AddDate(0, 0, -i).Truncate(time.Hour))
	}

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/adherence", nil)
	th.GetWeightPlanAdherence(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	days, window := d["days_logged_food"].(float64), d["logging_window"].(float64)
	if window != 7 {
		t.Fatalf("expected a 7-day window, got %v", window)
	}
	if days != 7 {
		t.Fatalf("expected exactly 7 days logged over a 7-day window, got %v", days)
	}
}

func TestGetCurrentNutritionGoal_includesTimelineAndForecast(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d", aw.Code)
	}

	// Log a declining trend across enough distinct days for a forecast.
	now := time.Now().UTC()
	for i, w := range []float64{232, 230, 228} {
		loggedAt := now.AddDate(0, 0, -(2 - i))
		wc, ww := newContext(uid, http.MethodPost, "/api/v1/weight", map[string]any{
			"weight":    w,
			"logged_at": loggedAt.Format(time.RFC3339),
		})
		th.LogWeight(wc)
		if ww.Code != http.StatusCreated {
			t.Fatalf("log weight %d: expected 201, got %d: %s", i, ww.Code, ww.Body.String())
		}
	}

	gc, gw := newContext(uid, http.MethodGet, "/api/v1/weight/plan/current", nil)
	th.GetCurrentNutritionGoal(gc)
	if gw.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", gw.Code, gw.Body.String())
	}
	d := settingsData(t, gw)

	timeline, ok := d["plan_timeline"].([]any)
	if !ok || len(timeline) != 3 {
		t.Fatalf("expected 3-point plan_timeline (single plan, not yet superseded), got %v", d["plan_timeline"])
	}
	forecast, ok := d["actual_forecast"].([]any)
	if !ok || len(forecast) == 0 {
		t.Fatalf("expected a non-empty actual_forecast with 3 days of declining data, got %v", d["actual_forecast"])
	}
}

// Regenerating a plan partway through the first one's timeline must produce
// one continuous "Plan" line: goal 1's points before the cutover, goal 2's
// from the cutover forward — not both plans' full trajectories overlapping.
func TestGetCurrentNutritionGoal_timelineStitchesAcrossRegeneratedPlans(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	ac1, aw1 := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(ac1)
	if aw1.Code != http.StatusCreated {
		t.Fatalf("first accept: expected 201, got %d", aw1.Code)
	}

	body2 := acceptPlanBody()
	body2["calorie_target"] = 1700
	body2["weekly_trajectory"] = []map[string]any{
		{"week": 0, "expected_weight": 225},
		{"week": 1, "expected_weight": 223},
	}
	ac2, aw2 := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", body2)
	th.AcceptWeightPlan(ac2)
	if aw2.Code != http.StatusCreated {
		t.Fatalf("second accept: expected 201, got %d", aw2.Code)
	}

	// Both goals landed at ~the same instant via CURRENT_TIMESTAMP; backdate
	// goal 1 and its projections so there's a real gap to clip, then move
	// goal 2's cutover to exactly base+10d (between goal 1's week-1 and
	// week-2 projections, which are 7 and 14 days out respectively).
	goal1EffectiveAt := base
	goal2EffectiveAt := base.AddDate(0, 0, 10)
	mustExec(t, `UPDATE nutrition_goals SET effective_at = ? WHERE user_id = ? AND calorie_target = 1800`, goal1EffectiveAt, uid)
	mustExec(t, `UPDATE nutrition_goals SET effective_at = ? WHERE user_id = ? AND calorie_target = 1700`, goal2EffectiveAt, uid)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = ?
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ? AND calorie_target = 1800) AND week = 0`, base, uid)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = ?
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ? AND calorie_target = 1800) AND week = 1`, base.AddDate(0, 0, 7), uid)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = ?
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ? AND calorie_target = 1800) AND week = 2`, base.AddDate(0, 0, 14), uid)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = ?
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ? AND calorie_target = 1700) AND week = 0`, goal2EffectiveAt, uid)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = ?
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ? AND calorie_target = 1700) AND week = 1`, goal2EffectiveAt.AddDate(0, 0, 7), uid)

	timeline, err := th.s.NutritionGoal.Timeline(uid)
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	// Expect: goal 1's week-0 (base) and week-1 (base+7d) survive (both
	// before goal 2's base+10d cutover); goal 1's week-2 (base+14d) is
	// clipped since it falls after the cutover; goal 2's two points follow.
	if len(timeline) != 4 {
		t.Fatalf("expected 4 stitched points, got %d: %+v", len(timeline), timeline)
	}
	if timeline[0].ExpectedWeight != 230 || timeline[1].ExpectedWeight != 228 {
		t.Fatalf("expected goal 1's week 0/1 first, got %+v", timeline[:2])
	}
	if timeline[2].ExpectedWeight != 225 || timeline[3].ExpectedWeight != 223 {
		t.Fatalf("expected goal 2's points after the cutover, got %+v", timeline[2:])
	}
	for _, p := range timeline {
		if p.ExpectedDate.After(base.AddDate(0, 0, 10)) && p.ExpectedWeight == 230 {
			t.Fatalf("goal 1's point after the cutover should have been clipped: %+v", p)
		}
	}
}

func TestGetWeightPlanAdherence_flagsShouldRegenerateWhenPlanExpired(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d", aw.Code)
	}

	// acceptPlanBody's trajectory ends at week 2 (14 days out); push every
	// projection's expected_date into the past so the plan reads as expired.
	past := time.Now().UTC().AddDate(0, 0, -30)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = ?
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ?)`, past, uid)

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/adherence", nil)
	th.GetWeightPlanAdherence(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if should, _ := d["should_regenerate"].(bool); !should {
		t.Fatalf("expected should_regenerate=true for an expired plan, got %v", d["should_regenerate"])
	}
	if reason, _ := d["regenerate_reason"].(string); reason == "" {
		t.Fatalf("expected a non-empty regenerate_reason")
	}
}

func mustExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := db.DB.Exec(query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

// A second call within the same calendar week must reuse the cached
// motivational note rather than regenerating it (weekly-refresh contract).
func TestGetWeightPlanAdherence_motivationNoteCachedWithinWeek(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d", aw.Code)
	}

	c1, w1 := newContext(uid, http.MethodGet, "/api/v1/weight/plan/adherence", nil)
	th.GetWeightPlanAdherence(c1)
	d1 := settingsData(t, w1)

	c2, w2 := newContext(uid, http.MethodGet, "/api/v1/weight/plan/adherence", nil)
	th.GetWeightPlanAdherence(c2)
	d2 := settingsData(t, w2)

	if d1["motivational_note"] != d2["motivational_note"] {
		t.Fatalf("motivational_note changed within the same week: %v vs %v", d1["motivational_note"], d2["motivational_note"])
	}
}

// The refresh=1 bypass must still return a usable response even with no AI
// provider configured (this test harness has none) — it exercises the
// forceRefresh code path without asserting on content that requires a mock
// vision provider to vary.
func TestGetWeightPlanAdherence_refreshBypassesCache(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", acceptPlanBody())
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d", aw.Code)
	}

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/adherence?refresh=1", nil)
	th.GetWeightPlanAdherence(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["motivational_note"] == nil || d["motivational_note"] == "" {
		t.Fatalf("expected a non-empty motivational_note, got %v", d["motivational_note"])
	}
}
