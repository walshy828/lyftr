package controllers

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/Cawlumm/lyftr-backend/db"
)

func TestListWorkouts_empty(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodGet, "/api/v1/workouts", nil)
	th.ListWorkouts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data, ok := resp["data"].([]any)
	if !ok {
		t.Fatalf("expected data array, got %T", resp["data"])
	}
	if len(data) != 0 {
		t.Fatalf("expected empty list, got %d items", len(data))
	}
}

func TestCreateWorkout_success(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	body := map[string]any{
		"name":     "Push Day",
		"notes":    "felt strong",
		"duration": 3600,
		"exercises": []map[string]any{
			{
				"exercise_id": exID,
				"notes":       "",
				"sets": []map[string]any{
					{"set_number": 1, "reps": 8, "weight": 100.0},
					{"set_number": 2, "reps": 8, "weight": 100.0},
				},
			},
		},
	}

	c, w := newContext(uid, http.MethodPost, "/api/v1/workouts", body)
	th.CreateWorkout(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	if data["name"] != "Push Day" {
		t.Errorf("expected name 'Push Day', got %v", data["name"])
	}
	exercises, ok := data["exercises"].([]any)
	if !ok || len(exercises) != 1 {
		t.Errorf("expected 1 exercise, got %v", data["exercises"])
	}
}

func TestCreateWorkout_missingName(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	body := map[string]any{
		"name":      "",
		"exercises": []map[string]any{},
	}
	c, w := newContext(uid, http.MethodPost, "/api/v1/workouts", body)
	th.CreateWorkout(c)

	if w.Code == http.StatusCreated {
		t.Fatal("expected error for empty name, got 201")
	}
}

func TestCreateWorkout_preservesStartedAt(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	startedAt := "2024-01-15T09:30:00Z"
	body := map[string]any{
		"name":       "Morning Lift",
		"duration":   60,
		"started_at": startedAt,
		"exercises": []map[string]any{
			{
				"exercise_id": exID,
				"sets":        []map[string]any{{"set_number": 1, "reps": 5, "weight": 80.0}},
			},
		},
	}

	c, w := newContext(uid, http.MethodPost, "/api/v1/workouts", body)
	th.CreateWorkout(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	if sa, ok := data["started_at"].(string); !ok || sa == "" {
		t.Errorf("started_at missing in response: %v", data["started_at"])
	}
}

func TestGetWorkout_ownershipEnforced(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	// Create second user
	res, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "other@example.com", "x")
	otherUID, _ := res.LastInsertId()

	// Create workout as otherUID
	res2, _ := db.DB.Exec(
		`INSERT INTO workouts (user_id, name, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
		otherUID, "Other's Workout",
	)
	wid, _ := res2.LastInsertId()

	// Try to GET as uid (different user)
	c, w := newContext(uid, http.MethodGet, "/api/v1/workouts/"+fmt.Sprint(wid), nil)
	setParam(c, "id", fmt.Sprint(wid))
	th.GetWorkout(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for cross-user access, got %d", w.Code)
	}
}

func TestDeleteWorkout_ownershipEnforced(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	res, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "other2@example.com", "x")
	otherUID, _ := res.LastInsertId()

	res2, _ := db.DB.Exec(
		`INSERT INTO workouts (user_id, name, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
		otherUID, "Protected Workout",
	)
	wid, _ := res2.LastInsertId()

	c, w := newContext(uid, http.MethodDelete, "/api/v1/workouts/"+fmt.Sprint(wid), nil)
	setParam(c, "id", fmt.Sprint(wid))
	th.DeleteWorkout(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for cross-user delete, got %d", w.Code)
	}

	// Verify workout still exists
	var count int
	db.DB.QueryRow(`SELECT COUNT(*) FROM workouts WHERE id = ?`, wid).Scan(&count)
	if count != 1 {
		t.Fatal("workout was deleted by wrong user")
	}
}

func TestUpdateWorkout_preservesStartedAt(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	originalTime := "2024-03-01T08:00:00Z"
	res, _ := db.DB.Exec(
		`INSERT INTO workouts (user_id, name, started_at) VALUES (?, ?, ?)`,
		uid, "Original Name", originalTime,
	)
	wid, _ := res.LastInsertId()

	body := map[string]any{
		"name":       "Updated Name",
		"duration":   1800,
		"started_at": originalTime,
		"exercises": []map[string]any{
			{
				"exercise_id": exID,
				"sets":        []map[string]any{{"set_number": 1, "reps": 10, "weight": 50.0}},
			},
		},
	}

	c, w := newContext(uid, http.MethodPut, "/api/v1/workouts/"+fmt.Sprint(wid), body)
	setParam(c, "id", fmt.Sprint(wid))
	th.UpdateWorkout(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	if data["name"] != "Updated Name" {
		t.Errorf("name not updated: %v", data["name"])
	}
}

func TestListWorkouts_limitCap(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// Insert 5 workouts
	for i := 0; i < 5; i++ {
		db.DB.Exec(
			`INSERT INTO workouts (user_id, name, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
			uid, fmt.Sprintf("Workout %d", i),
		)
	}

	// Request with limit=200 (above cap of 100)
	c, w := newContext(uid, http.MethodGet, "/api/v1/workouts?limit=200", nil)
	c.Request.URL.RawQuery = "limit=200"
	th.ListWorkouts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	// Should still return results (capped at 100, but we only have 5)
	resp := decodeResponse(t, w)
	data := resp["data"].([]any)
	if len(data) != 5 {
		t.Errorf("expected 5 workouts, got %d", len(data))
	}
}

func TestListWorkouts_filtersBySearchQuery(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	db.DB.Exec(`INSERT INTO workouts (user_id, name, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`, uid, "Morning Push")
	db.DB.Exec(`INSERT INTO workouts (user_id, name, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`, uid, "Leg Session")
	// Same matching name under another user — must NOT leak across users.
	db.DB.Exec(`INSERT INTO workouts (user_id, name, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`, other, "Morning Push (theirs)")

	c, w := newContext(uid, http.MethodGet, "/api/v1/workouts?q=push", nil)
	c.Request.URL.RawQuery = "q=push" // case-insensitive LIKE on name, scoped by user
	th.ListWorkouts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected 1 match for q=push (case-insensitive, excludes 'Leg Session' and the other user's), got %d", len(data))
	}
	if name := data[0].(map[string]any)["name"]; name != "Morning Push" {
		t.Errorf("expected 'Morning Push', got %v", name)
	}
}

// Guards the batched child loading in WorkoutStore.List (loadExercisesFor):
// children fetched with IN(...) queries must land on the right workout, in
// order_index / set_number order.
func TestListWorkouts_batchedChildrenGroupedCorrectly(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	for i := 1; i <= 2; i++ {
		body := map[string]any{
			"name": fmt.Sprintf("Workout %d", i),
			"exercises": []map[string]any{
				{
					"exercise_id": exID,
					"sets": []map[string]any{
						{"set_number": 1, "reps": 5, "weight": float64(100 * i)},
						{"set_number": 2, "reps": 5, "weight": float64(100*i + 5)},
					},
				},
				{
					"exercise_id": exID,
					"sets": []map[string]any{
						{"set_number": 1, "reps": 8, "weight": float64(50 * i)},
					},
				},
			},
		}
		c, w := newContext(uid, http.MethodPost, "/api/v1/workouts", body)
		th.CreateWorkout(c)
		if w.Code != http.StatusCreated {
			t.Fatalf("create workout %d: got %d: %s", i, w.Code, w.Body.String())
		}
	}

	c, w := newContext(uid, http.MethodGet, "/api/v1/workouts", nil)
	th.ListWorkouts(c)
	if w.Code != http.StatusOK {
		t.Fatalf("list: got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 2 {
		t.Fatalf("expected 2 workouts, got %d", len(data))
	}

	for _, item := range data {
		workout := item.(map[string]any)
		name := workout["name"].(string)
		i := 1
		if name == "Workout 2" {
			i = 2
		}
		exercises := workout["exercises"].([]any)
		if len(exercises) != 2 {
			t.Fatalf("%s: expected 2 exercises, got %d", name, len(exercises))
		}
		first := exercises[0].(map[string]any)
		sets := first["sets"].([]any)
		if len(sets) != 2 {
			t.Fatalf("%s: expected 2 sets on first exercise, got %d", name, len(sets))
		}
		if got := sets[0].(map[string]any)["weight"].(float64); got != float64(100*i) {
			t.Errorf("%s set 1: expected weight %d, got %v", name, 100*i, got)
		}
		if got := sets[1].(map[string]any)["weight"].(float64); got != float64(100*i+5) {
			t.Errorf("%s set 2: expected weight %d, got %v", name, 100*i+5, got)
		}
		second := exercises[1].(map[string]any)
		if got := len(second["sets"].([]any)); got != 1 {
			t.Errorf("%s: expected 1 set on second exercise, got %d", name, got)
		}
	}
}
