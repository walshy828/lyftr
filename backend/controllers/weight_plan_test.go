package controllers

import (
	"net/http"
	"testing"
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
