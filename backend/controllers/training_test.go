package controllers

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/stores"
)

// mkExercise inserts a library exercise with a literal category/source and no
// modality, i.e. the state a fresh library sync leaves behind.
func mkExercise(t *testing.T, name, muscle, category, source string) int64 {
	t.Helper()
	res, err := db.DB.Exec(`INSERT INTO exercises (name, muscle_group, category, source) VALUES (?, ?, ?, ?)`,
		name, muscle, category, source)
	if err != nil {
		t.Fatalf("insert exercise %q: %v", name, err)
	}
	id, _ := res.LastInsertId()
	return id
}

func postProgram(t *testing.T, uid int64, body map[string]any) (int, map[string]any) {
	t.Helper()
	c, w := newContext(uid, http.MethodPost, "/api/v1/programs", body)
	th.CreateProgram(c)
	if w.Code != http.StatusCreated {
		return w.Code, nil
	}
	return w.Code, decodeResponse(t, w)["data"].(map[string]any)
}

func postWorkout(t *testing.T, uid int64, body map[string]any) map[string]any {
	t.Helper()
	c, w := newContext(uid, http.MethodPost, "/api/v1/workouts", body)
	th.CreateWorkout(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /workouts: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	return decodeResponse(t, w)["data"].(map[string]any)
}

func exList(ids ...int64) []map[string]any {
	out := []map[string]any{}
	for _, id := range ids {
		out = append(out, map[string]any{"exercise_id": id, "sets": []map[string]any{{"set_number": 1}}})
	}
	return out
}

func TestInferModality_goAndSQLAgree(t *testing.T) {
	setupTestDB(t)
	cases := []struct {
		name, category, source, want string
	}{
		{"Barbell Squat", "strength", "free", "strength"},
		{"hamstring stretch", "upper legs", "gymvisual", "mobility"}, // body-part category library
		{"butterfly yoga pose", "upper legs", "gymvisual", "mobility"},
		{"Pigeon", "stretching", "free", "mobility"},
		{"Walk", "cardio", "baseline", "cardio"},
		{"Jumping Jacks", "cardio", "gymvisual", "cardio"},
		{"ankle circles", "lower legs", "gymvisual", "strength"}, // the rule's known miss; fixed by override
	}
	for _, tc := range cases {
		mkExercise(t, tc.name, "x", tc.category, tc.source)
		if got := stores.InferModality(tc.category, tc.source, tc.name); got != tc.want {
			t.Errorf("Go InferModality(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
	if err := th.s.Training.Backfill(); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	for _, tc := range cases {
		var got string
		db.DB.QueryRow(`SELECT modality FROM exercises WHERE name = ?`, tc.name).Scan(&got)
		if got != tc.want {
			t.Errorf("SQL backfill %q = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestInferKind_thresholds(t *testing.T) {
	for _, tc := range []struct {
		counts map[string]int
		want   string
	}{
		{map[string]int{}, "strength"},
		{map[string]int{"mobility": 5, "strength": 3}, "mobility"}, // 62% ≥ 60%
		{map[string]int{"strength": 6, "mobility": 1}, "strength"}, // a cool-down stretch doesn't make it mixed
		{map[string]int{"strength": 2, "cardio": 2}, "mixed"},
		{map[string]int{"cardio": 1}, "cardio"},
	} {
		if got := stores.InferKind(tc.counts); got != tc.want {
			t.Errorf("InferKind(%v) = %q, want %q", tc.counts, got, tc.want)
		}
	}
}

func TestProgramKind_inferredExplicitAndValidated(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	s1 := mkExercise(t, "Couch Stretch", "quads", "upper legs", "gymvisual")
	s2 := mkExercise(t, "hamstring stretch", "hamstrings", "upper legs", "gymvisual")
	lift := mkExercise(t, "Bench Press", "chest", "strength", "free")

	_, p := postProgram(t, uid, map[string]any{"name": "Morning Flow", "exercises": exList(s1, s2, lift)})
	if p["kind"] != "mobility" {
		t.Errorf("2 stretches + 1 lift: expected inferred mobility, got %v", p["kind"])
	}

	_, p = postProgram(t, uid, map[string]any{"name": "Bench + stretch", "kind": "strength", "exercises": exList(s1, s2, lift)})
	if p["kind"] != "strength" {
		t.Errorf("explicit kind must win over inference, got %v", p["kind"])
	}

	if code, _ := postProgram(t, uid, map[string]any{"name": "Bad", "kind": "yoga", "exercises": exList(lift)}); code != http.StatusBadRequest && code != http.StatusUnprocessableEntity {
		t.Errorf("invalid kind: expected 4xx, got %d", code)
	}
}

func TestWorkoutKind_inheritsRoutineElseInfers(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	ankle := mkExercise(t, "ankle circles", "calves", "lower legs", "gymvisual") // reads as strength
	stretch := mkExercise(t, "hamstring stretch", "hamstrings", "upper legs", "gymvisual")

	_, p := postProgram(t, uid, map[string]any{"name": "Mobility", "kind": "mobility", "exercises": exList(ankle)})
	pid := int64(p["id"].(float64))

	w := postWorkout(t, uid, map[string]any{"name": "Mobility", "program_id": pid, "exercises": exList(ankle)})
	if w["kind"] != "mobility" {
		t.Errorf("routine session should inherit the routine's kind, got %v", w["kind"])
	}

	w = postWorkout(t, uid, map[string]any{"name": "Freestyle", "exercises": exList(stretch)})
	if w["kind"] != "mobility" {
		t.Errorf("freestyle stretch session should infer mobility, got %v", w["kind"])
	}

	// An edit without kind keeps the routine's type rather than re-inferring.
	w = postWorkout(t, uid, map[string]any{"name": "Mobility again", "program_id": pid, "exercises": exList(ankle)})
	c, rec := newContext(uid, http.MethodPut, "/api/v1/workouts/x", map[string]any{"name": "Edited", "exercises": exList(ankle)})
	setParam(c, "id", strconv.FormatInt(int64(w["id"].(float64)), 10))
	th.UpdateWorkout(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT workout: %d %s", rec.Code, rec.Body.String())
	}
	if got := decodeResponse(t, rec)["data"].(map[string]any)["kind"]; got != "mobility" {
		t.Errorf("edited routine session should stay mobility, got %v", got)
	}
}

func TestBackfill_classifiesExistingRows(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	stretch := mkExercise(t, "9090 Stretch", "core", "strength", "")
	pid := makeProgram(t, uid, "Old Flow")
	db.DB.Exec(`INSERT INTO program_exercises (program_id, exercise_id) VALUES (?, ?)`, pid, stretch)
	res, _ := db.DB.Exec(`INSERT INTO workouts (user_id, name, program_id) VALUES (?, 'Old Flow', ?)`, uid, pid)
	wid, _ := res.LastInsertId()
	res, _ = db.DB.Exec(`INSERT INTO workouts (user_id, name) VALUES (?, 'Empty')`, uid)
	emptyID, _ := res.LastInsertId()

	if err := th.s.Training.Backfill(); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var pk, wk, ek string
	db.DB.QueryRow(`SELECT kind FROM programs WHERE id = ?`, pid).Scan(&pk)
	db.DB.QueryRow(`SELECT kind FROM workouts WHERE id = ?`, wid).Scan(&wk)
	db.DB.QueryRow(`SELECT kind FROM workouts WHERE id = ?`, emptyID).Scan(&ek)
	if pk != "mobility" || wk != "mobility" || ek != "strength" {
		t.Errorf("backfill: program=%q workout=%q empty=%q, want mobility/mobility/strength", pk, wk, ek)
	}
	// Idempotent: a second run is a no-op, not an error.
	if err := th.s.Training.Backfill(); err != nil {
		t.Fatalf("second backfill: %v", err)
	}
}

func TestTrainingTypeDays_mergesWorkoutsMixedAndSyncedCardio(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	lift := mkExercise(t, "Squat", "quads", "strength", "free")
	stretch := mkExercise(t, "Quad Stretch", "quads", "stretching", "free")
	th.s.Training.Backfill()

	const day = "2026-11-09T15:00:00Z"
	// 60-min mixed session: 3 lifts + 1 stretch → 45 strength, 15 mobility.
	postWorkout(t, uid, map[string]any{"name": "Legs", "kind": "mixed", "duration": 3600, "started_at": day,
		"exercises": exList(lift, lift, lift, stretch)})
	// 10-min stretch session.
	postWorkout(t, uid, map[string]any{"name": "Stretch", "duration": 600, "started_at": "2026-11-09T21:00:00Z",
		"exercises": exList(stretch)})
	// 30-min watch walk.
	db.DB.Exec(`INSERT INTO cardio_sessions (user_id, external_id, activity_type, started_at, ended_at, duration_seconds)
	            VALUES (?, 'w1', 'walking', '2026-11-09T18:00:00Z', '2026-11-09T18:30:00Z', 1800)`, uid)

	q := "from=2026-11-09&to=2026-11-09&tz_offset=0"
	c, w := newContext(uid, http.MethodGet, "/api/v1/training/days?"+q, nil)
	c.Request.URL.RawQuery = q
	th.GetTrainingTypeDays(c)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /training/days: %d %s", w.Code, w.Body.String())
	}
	days := decodeResponse(t, w)["data"].([]any)
	if len(days) != 1 {
		t.Fatalf("expected 1 day, got %d", len(days))
	}
	d := days[0].(map[string]any)
	check := func(kind string, sessions, minutes float64) {
		k := d[kind].(map[string]any)
		if k["sessions"] != sessions || k["minutes"] != minutes {
			t.Errorf("%s: got sessions=%v minutes=%v, want %v/%v", kind, k["sessions"], k["minutes"], sessions, minutes)
		}
	}
	check("strength", 1, 45)
	check("mobility", 2, 25)
	check("cardio", 1, 30)
}

func TestTrainingGoals_defaultsSaveAndValidate(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	get := func() []any {
		c, w := newContext(uid, http.MethodGet, "/api/v1/training/goals", nil)
		th.GetTrainingGoals(c)
		return decodeResponse(t, w)["data"].([]any)
	}
	g := get()
	if len(g) != 3 || g[0].(map[string]any)["kind"] != "strength" || g[1].(map[string]any)["minutes_per_week"] != float64(150) {
		t.Fatalf("unexpected defaults: %v", g)
	}

	c, w := newContext(uid, http.MethodPut, "/api/v1/training/goals", []map[string]any{{"kind": "mobility", "days_per_week": 7, "minutes_per_week": 70}})
	th.PutTrainingGoals(c)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT goals: %d %s", w.Code, w.Body.String())
	}
	g = get()
	if m := g[2].(map[string]any); m["days_per_week"] != float64(7) || m["minutes_per_week"] != float64(70) {
		t.Errorf("mobility goal not saved: %v", m)
	}
	if g[0].(map[string]any)["days_per_week"] != float64(3) {
		t.Errorf("untouched strength goal should keep its default: %v", g[0])
	}

	for _, bad := range [][]map[string]any{
		{{"kind": "yoga", "days_per_week": 1}},
		{{"kind": "strength", "days_per_week": 8}},
		{{"kind": "cardio"}, {"kind": "cardio"}},
	} {
		c, w := newContext(uid, http.MethodPut, "/api/v1/training/goals", bad)
		th.PutTrainingGoals(c)
		if w.Code != http.StatusBadRequest {
			t.Errorf("PUT %v: expected 400, got %d", bad, w.Code)
		}
	}
}

func TestWorkoutStats_kindFilterKeepsStretchesOffMuscleMap(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	stretch := mkExercise(t, "Hamstring Stretch", "hamstrings", "stretching", "free")
	th.s.Training.Backfill()
	seedWorkoutOn(t, uid, stretch, "2026-11-09T15:00:00Z", 600, [][2]float64{{1, 0}})
	th.s.Training.Backfill()

	muscleSets := func(kind string) float64 {
		q := "from=2026-11-01&to=2026-11-10&tz_offset=0&include=muscles&kind=" + kind
		c, w := newContext(uid, http.MethodGet, "/api/v1/workouts/stats?"+q, nil)
		c.Request.URL.RawQuery = q
		th.GetWorkoutStats(c)
		if w.Code != http.StatusOK {
			t.Fatalf("stats kind=%s: %d %s", kind, w.Code, w.Body.String())
		}
		for _, m := range decodeResponse(t, w)["data"].(map[string]any)["muscles"].([]any) {
			mm := m.(map[string]any)
			if mm["muscle_group"] == "hamstrings" {
				return mm["sets"].(float64)
			}
		}
		return -1
	}
	if got := muscleSets("strength"); got != 0 {
		t.Errorf("strength muscle map: a stretch must not count as hamstring training, got %v sets", got)
	}
	if got := muscleSets("mobility"); got != 1 {
		t.Errorf("mobility muscle map: expected the stretch, got %v sets", got)
	}
}
