package controllers

import (
	"fmt"
	"math"
	"net/http"
	"testing"

	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/utils"
)

// seedWorkoutWithSet creates a workout → workout_exercise → set for a given user/exercise.
func seedWorkoutWithSet(t *testing.T, userID, exID int64, weight float64, reps int, isWarmup int) {
	t.Helper()
	var wID int64
	row := db.DB.QueryRow(
		`INSERT INTO workouts (user_id, name, duration, started_at) VALUES (?, 'Test Workout', 3600, CURRENT_TIMESTAMP) RETURNING id`,
		userID,
	)
	if err := row.Scan(&wID); err != nil {
		t.Fatalf("insert workout: %v", err)
	}
	var weID int64
	row = db.DB.QueryRow(
		`INSERT INTO workout_exercises (workout_id, exercise_id, order_index) VALUES (?, ?, 0) RETURNING id`,
		wID, exID,
	)
	if err := row.Scan(&weID); err != nil {
		t.Fatalf("insert workout_exercise: %v", err)
	}
	_, err := db.DB.Exec(
		`INSERT INTO sets (workout_exercise_id, set_number, reps, weight, is_warmup) VALUES (?, 1, ?, ?, ?)`,
		weID, reps, weight, isWarmup,
	)
	if err != nil {
		t.Fatalf("insert set: %v", err)
	}
}

func TestGetExercisePRs_noHistory(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/prs", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExercisePRs(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	if resp["data"] != nil {
		t.Fatalf("expected nil data for exercise with no history, got %v", resp["data"])
	}
}

func TestGetExercisePRs_returnsBestSet(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	seedWorkoutWithSet(t, uid, exID, 100.0, 5, 0)
	seedWorkoutWithSet(t, uid, exID, 120.0, 3, 0) // heavier — should be PR
	seedWorkoutWithSet(t, uid, exID, 80.0, 10, 0)

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/prs", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExercisePRs(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected data object, got %T: %v", resp["data"], resp["data"])
	}
	if data["weight"].(float64) != 120.0 {
		t.Fatalf("expected PR weight 120, got %v", data["weight"])
	}
	if data["reps"].(float64) != 3 {
		t.Fatalf("expected PR reps 3, got %v", data["reps"])
	}
	if data["estimated_1rm"] == nil {
		t.Fatal("expected estimated_1rm in response")
	}
}

func TestGetExercisePRs_ignoresWarmup(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	seedWorkoutWithSet(t, uid, exID, 200.0, 1, 1) // warmup — should be excluded
	seedWorkoutWithSet(t, uid, exID, 100.0, 5, 0)

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/prs", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExercisePRs(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	if data["weight"].(float64) != 100.0 {
		t.Fatalf("expected PR weight 100 (warmup excluded), got %v", data["weight"])
	}
}

func TestGetExercisePRs_isolatesUser(t *testing.T) {
	setupTestDB(t)
	uid1 := createTestUser(t)
	uid2, err := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES ('other@example.com', 'x')`)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := uid2.LastInsertId()
	exID := createTestExercise(t)

	seedWorkoutWithSet(t, int64(other), exID, 200.0, 5, 0) // other user's PR
	seedWorkoutWithSet(t, uid1, exID, 100.0, 5, 0)

	c, w := newContext(uid1, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/prs", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExercisePRs(c)

	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	if data["weight"].(float64) != 100.0 {
		t.Fatalf("expected user1 PR 100, got %v (should not see other user data)", data["weight"])
	}
}

func TestGetExercisePRs_invalidID(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodGet, "/api/v1/exercises/bad/prs", nil)
	setParam(c, "id", "bad")
	th.GetExercisePRs(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetExerciseHistory_empty(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/history", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExerciseHistory(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data, ok := resp["data"].([]any)
	if !ok {
		t.Fatalf("expected data array, got %T", resp["data"])
	}
	if len(data) != 0 {
		t.Fatalf("expected empty history, got %d items", len(data))
	}
}

func TestGetExerciseHistory_returnsSessionsGrouped(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	seedWorkoutWithSet(t, uid, exID, 100.0, 8, 0)
	seedWorkoutWithSet(t, uid, exID, 110.0, 6, 0)
	seedWorkoutWithSet(t, uid, exID, 120.0, 4, 0)

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/history", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExerciseHistory(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data, ok := resp["data"].([]any)
	if !ok {
		t.Fatalf("expected data array, got %T", resp["data"])
	}
	if len(data) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(data))
	}
	first := data[0].(map[string]any)
	if first["max_weight"] == nil || first["total_volume"] == nil || first["sets_count"] == nil {
		t.Fatalf("missing fields in history point: %v", first)
	}
}

// The best set is the one with the highest estimated 1RM, which is not always
// the heaviest. 10x225 (e1RM 300) beats 1x250 — and the whole reason to plot
// e1RM is that max weight alone would call the lighter session the better one.
func TestGetExerciseHistory_bestSetRankedBy1RM(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	var wID int64
	db.DB.QueryRow(
		`INSERT INTO workouts (user_id, name, duration, started_at) VALUES (?, 'W', 3600, CURRENT_TIMESTAMP) RETURNING id`,
		uid,
	).Scan(&wID)
	var weID int64
	db.DB.QueryRow(
		`INSERT INTO workout_exercises (workout_id, exercise_id, order_index) VALUES (?, ?, 0) RETURNING id`,
		wID, exID,
	).Scan(&weID)
	db.DB.Exec(`INSERT INTO sets (workout_exercise_id, set_number, reps, weight, is_warmup, completed) VALUES (?,1,10,225,0,1)`, weID)
	db.DB.Exec(`INSERT INTO sets (workout_exercise_id, set_number, reps, weight, is_warmup, completed) VALUES (?,2,1,250,0,1)`, weID)

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/history", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExerciseHistory(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected the two sets to roll up into 1 session, got %d", len(data))
	}
	p := data[0].(map[string]any)

	if got := p["best_reps"].(float64); got != 10 {
		t.Errorf("expected the 10-rep set to win on e1RM, got best_reps %v", got)
	}
	if got := p["best_weight"].(float64); got != 225 {
		t.Errorf("expected best_weight 225, got %v", got)
	}
	if got := p["best_e1rm"].(float64); math.Abs(got-300) > 1e-6 {
		t.Errorf("expected e1RM 300, got %v", got)
	}
	// The session's own aggregates must still describe the whole session.
	if got := p["max_weight"].(float64); got != 250 {
		t.Errorf("expected max_weight 250 (the heaviest set), got %v", got)
	}
	if got := p["sets_count"].(float64); got != 2 {
		t.Errorf("expected 2 sets, got %v", got)
	}
	if got := p["total_reps"].(float64); got != 11 {
		t.Errorf("expected 11 total reps, got %v", got)
	}
	if got := p["workout_id"].(float64); int64(got) != wID {
		t.Errorf("expected workout_id %d for deep-linking, got %v", wID, got)
	}
}

// A single rep is a measurement, not an extrapolation — the SQL ranking
// expression must agree with utils.Epley1RM on that, or the chart and the PR
// card disagree by 3.3% on the same lift.
func TestGetExerciseHistory_singleRepIsNotInflated(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	seedWorkoutWithSet(t, uid, exID, 315.0, 1, 0)

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/history", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExerciseHistory(c)

	p := decodeResponse(t, w)["data"].([]any)[0].(map[string]any)
	if got := p["best_e1rm"].(float64); got != 315 {
		t.Errorf("a 1-rep max must estimate as itself, got %v", got)
	}
	if got := utils.Epley1RM(315, 1); got != p["best_e1rm"].(float64) {
		t.Errorf("SQL e1RM (%v) and utils.Epley1RM (%v) disagree", p["best_e1rm"], got)
	}
}

// Bodyweight and cardio work carries no load, so there is no max to estimate.
// Zero is the signal for "hide the series", not a low estimate.
func TestGetExerciseHistory_bodyweightHasNo1RM(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	seedWorkoutWithSet(t, uid, exID, 0, 20, 0)

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d/history", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExerciseHistory(c)

	p := decodeResponse(t, w)["data"].([]any)[0].(map[string]any)
	if got := p["best_e1rm"].(float64); got != 0 {
		t.Errorf("expected no e1RM for an unloaded set, got %v", got)
	}
	if got := p["total_reps"].(float64); got != 20 {
		t.Errorf("reps must still be tracked for bodyweight work, got %v", got)
	}
}

// richExercise seeds a fully-populated library row, including the fields the
// seed used to discard.
func richExercise(t *testing.T, name, muscle, equipment, level, mechanic, force, sourceID string) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO exercises (name, muscle_group, category, equipment, level, mechanic, "force", source_id, image_url, image_url_end)
		 VALUES (?, ?, 'strength', ?, ?, ?, ?, ?, ?, ?)`,
		name, muscle, equipment, level, mechanic, force, sourceID,
		"https://example.test/"+sourceID+"/0.jpg", "https://example.test/"+sourceID+"/1.jpg",
	)
	if err != nil {
		t.Fatalf("seed exercise %q: %v", name, err)
	}
	id, _ := res.LastInsertId()
	return id
}

func TestGetExercise_returnsEnrichedFields(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := richExercise(t, "Barbell Bench Press", "chest", "barbell", "beginner", "compound", "push", "Barbell_Bench_Press")

	c, w := newContext(uid, http.MethodGet, fmt.Sprintf("/api/v1/exercises/%d", exID), nil)
	setParam(c, "id", fmt.Sprintf("%d", exID))
	th.GetExercise(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := decodeResponse(t, w)["data"].(map[string]any)
	for field, want := range map[string]string{
		"level":         "beginner",
		"mechanic":      "compound",
		"force":         "push",
		"source_id":     "Barbell_Bench_Press",
		"image_url_end": "https://example.test/Barbell_Bench_Press/1.jpg",
	} {
		if d[field] != want {
			t.Errorf("%s = %v, want %q", field, d[field], want)
		}
	}
}

func TestListExercises_filtersOnNewFacets(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	richExercise(t, "Barbell Bench Press", "chest", "barbell", "beginner", "compound", "push", "bbp")
	richExercise(t, "Cable Fly", "chest", "cable", "intermediate", "isolation", "push", "cf")
	richExercise(t, "Pull Up", "lats", "body only", "intermediate", "compound", "pull", "pu")

	cases := []struct {
		query string
		want  []string
	}{
		{"level=intermediate", []string{"Cable Fly", "Pull Up"}},
		{"mechanic=isolation", []string{"Cable Fly"}},
		{"force=pull", []string{"Pull Up"}},
		// The headline use case: "what can I do with just a barbell".
		{"equipment=barbell", []string{"Barbell Bench Press"}},
		{"muscle_group=chest&mechanic=compound", []string{"Barbell Bench Press"}},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			c, w := newContext(uid, http.MethodGet, "/api/v1/exercises?"+tc.query, nil)
			c.Request.URL.RawQuery = tc.query
			th.ListExercises(c)

			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}
			data := decodeResponse(t, w)["data"].([]any)
			got := make([]string, len(data))
			for i, e := range data {
				got[i] = e.(map[string]any)["name"].(string)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("expected %v, got %v", tc.want, got)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("expected %v, got %v", tc.want, got)
					break
				}
			}
		})
	}
}

func TestGetExerciseFacets(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	richExercise(t, "Barbell Bench Press", "chest", "barbell", "beginner", "compound", "push", "bbp")
	richExercise(t, "Barbell Row", "back", "barbell", "beginner", "compound", "pull", "br")
	richExercise(t, "Cable Fly", "chest", "cable", "intermediate", "isolation", "push", "cf")
	// Empty values must not become a chip labelled "".
	db.DB.Exec(`INSERT INTO exercises (name, muscle_group, category) VALUES ('Mystery Move', '', 'strength')`)

	c, w := newContext(uid, http.MethodGet, "/api/v1/exercises/facets", nil)
	th.GetExerciseFacets(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	facets := decodeResponse(t, w)["data"].(map[string]any)

	for _, key := range []string{"muscle_group", "equipment", "category", "level", "mechanic", "force"} {
		if _, ok := facets[key]; !ok {
			t.Errorf("missing facet %q", key)
		}
	}

	equipment := facets["equipment"].([]any)
	// Ordered by count descending, so the most useful chip leads.
	first := equipment[0].(map[string]any)
	if first["value"] != "barbell" || first["count"].(float64) != 2 {
		t.Errorf("expected barbell x2 first, got %v", first)
	}

	for _, group := range facets["muscle_group"].([]any) {
		if group.(map[string]any)["value"] == "" {
			t.Error("an empty value became a filter chip")
		}
	}
}
