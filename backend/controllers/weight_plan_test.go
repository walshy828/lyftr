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

// The scenario the progress view exists for: a plan accepted on 1 Jan that
// promised 1 lb/week, six weeks of actual weigh-ins that only managed
// 0.5 lb/week, then a regeneration. The first plan's segment must keep
// reporting 1.0 target against 0.5 actual — the regeneration appends, it
// never rewrites the elapsed weeks.
func TestGetWeightPlanHistory_locksSupersededPlanPaceAgainstActual(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Plan 1: 230 lbs losing 1 lb/week for 12 weeks.
	traj1 := []map[string]any{}
	for wk := 0; wk <= 12; wk++ {
		traj1 = append(traj1, map[string]any{"week": wk, "expected_weight": 230 - float64(wk)})
	}
	body1 := acceptPlanBody()
	body1["weekly_trajectory"] = traj1
	ac1, aw1 := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", body1)
	th.AcceptWeightPlan(ac1)
	if aw1.Code != http.StatusCreated {
		t.Fatalf("first accept: expected 201, got %d: %s", aw1.Code, aw1.Body.String())
	}

	// Plan 2, accepted six weeks in from the real 227 lbs, at 0.75 lb/week.
	traj2 := []map[string]any{}
	for wk := 0; wk <= 8; wk++ {
		traj2 = append(traj2, map[string]any{"week": wk, "expected_weight": 227 - 0.75*float64(wk)})
	}
	body2 := acceptPlanBody()
	body2["calorie_target"] = 1700
	body2["weekly_trajectory"] = traj2
	ac2, aw2 := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", body2)
	th.AcceptWeightPlan(ac2)
	if aw2.Code != http.StatusCreated {
		t.Fatalf("second accept: expected 201, got %d: %s", aw2.Code, aw2.Body.String())
	}

	// Both goals landed at CURRENT_TIMESTAMP; backdate them and their
	// projections onto the 1 Jan / 12 Feb timeline this scenario describes.
	goal2At := base.AddDate(0, 0, 42) // six weeks in
	mustExec(t, `UPDATE nutrition_goals SET effective_at = ? WHERE user_id = ? AND calorie_target = 1800`, base, uid)
	mustExec(t, `UPDATE nutrition_goals SET effective_at = ? WHERE user_id = ? AND calorie_target = 1700`, goal2At, uid)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = datetime(?, '+' || (week * 7) || ' days')
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ? AND calorie_target = 1800)`, base.Format("2006-01-02"), uid)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = datetime(?, '+' || (week * 7) || ' days')
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ? AND calorie_target = 1700)`, goal2At.Format("2006-01-02"), uid)

	// Six weekly weigh-ins losing only 0.5 lb/week: 230 -> 227.
	for wk := 0; wk <= 6; wk++ {
		mustExec(t, `INSERT INTO weight_logs (user_id, weight, logged_at) VALUES (?, ?, ?)`,
			uid, 230-0.5*float64(wk), base.AddDate(0, 0, wk*7))
	}

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/history?from=2026-01-01", nil)
	th.GetWeightPlanHistory(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)

	if d["journey_start"] != "2026-01-01" {
		t.Fatalf("expected journey_start 2026-01-01, got %v", d["journey_start"])
	}

	segments, ok := d["segments"].([]any)
	if !ok || len(segments) == 0 {
		t.Fatalf("expected at least one segment, got %v", d["segments"])
	}
	first, _ := segments[0].(map[string]any)
	if first["from"] != "2026-01-01" {
		t.Fatalf("expected the first segment to start at the journey start, got %v", first["from"])
	}
	if got := first["target_lbs_per_week"]; got != 1.0 {
		t.Fatalf("expected the superseded plan to still report a 1.0 lbs/week target, got %v", got)
	}
	if got := first["actual_lbs_per_week"]; got != 0.5 {
		t.Fatalf("expected the superseded plan's actual pace to stay locked at 0.5 lbs/week, got %v", got)
	}
	if first["is_current"] != false {
		t.Fatalf("expected the superseded plan not to be flagged current, got %v", first["is_current"])
	}

	// Week 5 is the last bucket plan 1 still governs (week 6 is the cutover
	// date itself, where plan 2 takes over and re-baselines to the real
	// weight). Plan 1 said 225 there; the user was actually 227.5, so the
	// locked variance is +2.5 — and it stays that way after regeneration.
	weeks, ok := d["weeks"].([]any)
	if !ok || len(weeks) < 7 {
		t.Fatalf("expected at least 7 weekly buckets, got %v", d["weeks"])
	}
	wk5, _ := weeks[5].(map[string]any)
	if wk5["target_weight"] != 225.0 || wk5["actual_weight"] != 227.5 {
		t.Fatalf("expected week 5 to be 225 target / 227.5 actual, got %v / %v", wk5["target_weight"], wk5["actual_weight"])
	}
	if wk5["variance_lbs"] != 2.5 {
		t.Fatalf("expected week 5 variance of +2.5, got %v", wk5["variance_lbs"])
	}
	if int64(wk5["goal_id"].(float64)) == int64(wk6GoalID(t, weeks)) {
		t.Fatalf("expected week 5 to still be attributed to the superseded plan, not the new one")
	}
}

// The ?from window narrows the record without changing what it reports: the
// same weeks, just fewer of them.
func TestGetWeightPlanHistory_honorsFromWindowAndRemembersSetting(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	traj := []map[string]any{}
	for wk := 0; wk <= 10; wk++ {
		traj = append(traj, map[string]any{"week": wk, "expected_weight": 230 - float64(wk)})
	}
	body := acceptPlanBody()
	body["weekly_trajectory"] = traj
	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", body)
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d", aw.Code)
	}
	mustExec(t, `UPDATE nutrition_goals SET effective_at = ? WHERE user_id = ?`, base, uid)
	mustExec(t, `UPDATE weight_plan_projections SET expected_date = datetime(?, '+' || (week * 7) || ' days')
	             WHERE nutrition_goal_id = (SELECT id FROM nutrition_goals WHERE user_id = ?)`, base.Format("2006-01-02"), uid)

	// Persist a start date, then confirm an un-parameterized request uses it.
	sc, sw := newContext(uid, http.MethodPut, "/api/v1/settings", map[string]any{"plan_history_start": "2026-02-01"})
	th.UpdateSettings(sc)
	if sw.Code != http.StatusOK {
		t.Fatalf("save start date: expected 200, got %d: %s", sw.Code, sw.Body.String())
	}

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/history", nil)
	th.GetWeightPlanHistory(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["from"] != "2026-02-01" {
		t.Fatalf("expected the remembered start date to be used, got %v", d["from"])
	}
	if d["journey_start"] != "2026-01-01" {
		t.Fatalf("expected journey_start to stay at the first plan's date, got %v", d["journey_start"])
	}

	// An explicit ?from overrides the saved setting without overwriting it.
	c2, w2 := newContext(uid, http.MethodGet, "/api/v1/weight/plan/history?from=2026-01-15", nil)
	th.GetWeightPlanHistory(c2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	if got := settingsData(t, w2)["from"]; got != "2026-01-15" {
		t.Fatalf("expected the query param to win, got %v", got)
	}

	sc2, sw2 := newContext(uid, http.MethodGet, "/api/v1/settings", nil)
	th.GetSettings(sc2)
	if got := settingsData(t, sw2)["plan_history_start"]; got != "2026-02-01" {
		t.Fatalf("a one-off ?from must not overwrite the saved date, got %v", got)
	}
}

// Structured plan text round-trips through accept and back out of the goal
// endpoints, and backfills the flat notes column when no prose was sent.
func TestAcceptWeightPlan_roundTripsStructuredPlanDetail(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	body := acceptPlanBody()
	delete(body, "notes")
	body["plan_detail"] = map[string]any{
		"summary": "1,800 kcal/day to reach 190 lbs in about 12 weeks.",
		"sections": []map[string]any{
			{"heading": "How these targets were built", "bullets": []string{"TDEE is about 2,300 kcal", "A 500 kcal deficit gives ~1 lb/week"}},
			{"heading": "Safety", "bullets": []string{"Never drop below 1,500 kcal"}},
		},
	}
	ac, aw := newContext(uid, http.MethodPost, "/api/v1/weight/plan/accept", body)
	th.AcceptWeightPlan(ac)
	if aw.Code != http.StatusCreated {
		t.Fatalf("accept: expected 201, got %d: %s", aw.Code, aw.Body.String())
	}

	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/plan/current", nil)
	th.GetCurrentNutritionGoal(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	goal, _ := settingsData(t, w)["goal"].(map[string]any)
	detail, ok := goal["detail"].(map[string]any)
	if !ok {
		t.Fatalf("expected structured detail on the goal, got %v", goal["detail"])
	}
	if detail["summary"] != "1,800 kcal/day to reach 190 lbs in about 12 weeks." {
		t.Fatalf("summary did not round-trip, got %v", detail["summary"])
	}
	sections, _ := detail["sections"].([]any)
	if len(sections) != 2 {
		t.Fatalf("expected 2 sections, got %v", detail["sections"])
	}
	// notes is the plain-text fallback for anything not rendering `detail`.
	if goal["notes"] == "" {
		t.Fatalf("expected notes to be backfilled from the structured detail")
	}
}

// wk6GoalID pulls the goal that owns the cutover bucket, so the assertion
// above can prove week 5 is still attributed to the *previous* plan.
func wk6GoalID(t *testing.T, weeks []any) float64 {
	t.Helper()
	wk6, _ := weeks[6].(map[string]any)
	id, _ := wk6["goal_id"].(float64)
	return id
}
