package controllers

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/Cawlumm/lyftr-backend/db"
)

func TestListPrograms_empty(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodGet, "/api/v1/programs", nil)
	th.ListPrograms(c)

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

func TestCreateProgram_success(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	body := map[string]any{
		"name":  "PPL Program",
		"notes": "Push Pull Legs 6 days",
		"exercises": []map[string]any{
			{
				"exercise_id": exID,
				"notes":       "Focus on form",
				"sets": []map[string]any{
					{"set_number": 1, "target_reps": 5, "target_weight": 100.0},
					{"set_number": 2, "target_reps": 5, "target_weight": 100.0},
					{"set_number": 3, "target_reps": 5, "target_weight": 100.0},
				},
			},
		},
	}

	c, w := newContext(uid, http.MethodPost, "/api/v1/programs", body)
	th.CreateProgram(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	if data["name"] != "PPL Program" {
		t.Errorf("expected name 'PPL Program', got %v", data["name"])
	}
	exercises, ok := data["exercises"].([]any)
	if !ok {
		t.Fatalf("exercises field missing or wrong type: %T = %v", data["exercises"], data["exercises"])
	}
	if len(exercises) != 1 {
		t.Fatalf("expected 1 exercise, got %d", len(exercises))
	}
	ex0 := exercises[0].(map[string]any)
	sets, ok := ex0["sets"].([]any)
	if !ok {
		t.Fatalf("sets field missing or wrong type: %T = %v", ex0["sets"], ex0["sets"])
	}
	if len(sets) != 3 {
		t.Errorf("expected 3 sets, got %d", len(sets))
	}
}

func TestCreateProgram_missingName(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	body := map[string]any{
		"name":      "",
		"exercises": []map[string]any{},
	}
	c, w := newContext(uid, http.MethodPost, "/api/v1/programs", body)
	th.CreateProgram(c)

	if w.Code == http.StatusCreated {
		t.Fatal("expected error for empty name, got 201")
	}
}

func TestGetProgram_ownershipEnforced(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	res, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "prog_other@example.com", "x")
	otherUID, _ := res.LastInsertId()

	res2, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, otherUID, "Private Program")
	pid, _ := res2.LastInsertId()

	c, w := newContext(uid, http.MethodGet, "/api/v1/programs/"+fmt.Sprint(pid), nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.GetProgram(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for cross-user access, got %d", w.Code)
	}
}

func TestDeleteProgram_ownershipEnforced(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	res, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "prog_other2@example.com", "x")
	otherUID, _ := res.LastInsertId()

	res2, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, otherUID, "Protected Program")
	pid, _ := res2.LastInsertId()

	c, w := newContext(uid, http.MethodDelete, "/api/v1/programs/"+fmt.Sprint(pid), nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.DeleteProgram(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for cross-user delete, got %d", w.Code)
	}

	var count int
	db.DB.QueryRow(`SELECT COUNT(*) FROM programs WHERE id = ?`, pid).Scan(&count)
	if count != 1 {
		t.Fatal("program was deleted by wrong user")
	}
}

func TestUpdateProgram_replacesExercises(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	// Create second exercise
	res, _ := db.DB.Exec(`INSERT INTO exercises (name, muscle_group, category) VALUES (?, ?, ?)`, "Test Exercise 2", "back", "strength")
	exID2, _ := res.LastInsertId()

	// Create program with 1 exercise
	progRes, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "Original")
	pid, _ := progRes.LastInsertId()
	exRes, _ := db.DB.Exec(`INSERT INTO program_exercises (program_id, exercise_id, order_index) VALUES (?, ?, 0)`, pid, exID)
	peid, _ := exRes.LastInsertId()
	db.DB.Exec(`INSERT INTO program_sets (program_exercise_id, set_number, target_reps) VALUES (?, 1, 5)`, peid)

	// Update with different exercise
	body := map[string]any{
		"name":  "Updated Program",
		"notes": "",
		"exercises": []map[string]any{
			{
				"exercise_id": exID2,
				"notes":       "",
				"sets":        []map[string]any{{"set_number": 1, "target_reps": 8, "target_weight": 60.0}},
			},
		},
	}

	c, w := newContext(uid, http.MethodPut, "/api/v1/programs/"+fmt.Sprint(pid), body)
	setParam(c, "id", fmt.Sprint(pid))
	th.UpdateProgram(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Old exercise should be gone
	var count int
	db.DB.QueryRow(`SELECT COUNT(*) FROM program_exercises WHERE program_id = ? AND exercise_id = ?`, pid, exID).Scan(&count)
	if count != 0 {
		t.Error("old exercise not removed after update")
	}

	// New exercise should exist
	db.DB.QueryRow(`SELECT COUNT(*) FROM program_exercises WHERE program_id = ? AND exercise_id = ?`, pid, exID2).Scan(&count)
	if count != 1 {
		t.Error("new exercise not found after update")
	}
}

func TestCreateProgram_setNumberNormalized(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := createTestExercise(t)

	// Send set_number: 0 — backend should normalize to 1
	body := map[string]any{
		"name": "Norm Test",
		"exercises": []map[string]any{
			{
				"exercise_id": exID,
				"sets":        []map[string]any{{"set_number": 0, "target_reps": 10, "target_weight": 50.0}},
			},
		},
	}

	c, w := newContext(uid, http.MethodPost, "/api/v1/programs", body)
	th.CreateProgram(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	exercises := data["exercises"].([]any)
	sets := exercises[0].(map[string]any)["sets"].([]any)
	setNum := sets[0].(map[string]any)["set_number"].(float64)
	if setNum != 1 {
		t.Errorf("expected set_number 1 after normalization, got %v", setNum)
	}
}

func TestListPrograms_filtersBySearchQuery(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "Push Day")
	db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "Leg Day")
	// Same matching name under another user — must NOT leak across users.
	db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, other, "Push Day (theirs)")

	c, w := newContext(uid, http.MethodGet, "/api/v1/programs?q=push", nil)
	c.Request.URL.RawQuery = "q=push" // case-insensitive LIKE on name, scoped by user
	th.ListPrograms(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected 1 match for q=push (case-insensitive, excludes 'Leg Day' and the other user's), got %d", len(data))
	}
	if name := data[0].(map[string]any)["name"]; name != "Push Day" {
		t.Errorf("expected 'Push Day', got %v", name)
	}
}

func TestListSharedPrograms_excludesOwnAndUnshared(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 1)`, uid, "My Shared Program")
	db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 0)`, uid, "My Private Program")
	db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 0)`, other, "Their Private Program")
	db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 1)`, other, "Their Shared Program")

	c, w := newContext(uid, http.MethodGet, "/api/v1/programs/shared", nil)
	th.ListSharedPrograms(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected 1 shared program from the other user, got %d", len(data))
	}
	row := data[0].(map[string]any)
	if row["name"] != "Their Shared Program" {
		t.Errorf("expected 'Their Shared Program', got %v", row["name"])
	}
	if row["owner_email"] != "other@example.com" {
		t.Errorf("expected owner_email 'other@example.com', got %v", row["owner_email"])
	}
}

func TestShareProgram_success(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "Sharable")
	pid, _ := res.LastInsertId()

	c, w := newContext(uid, http.MethodPost, "/api/v1/programs/"+fmt.Sprint(pid)+"/share", nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.ShareProgram(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["is_shared"] != true {
		t.Errorf("expected is_shared true, got %v", data["is_shared"])
	}

	// The other user should now see it in their shared list.
	c2, w2 := newContext(other, http.MethodGet, "/api/v1/programs/shared", nil)
	th.ListSharedPrograms(c2)
	shared := decodeResponse(t, w2)["data"].([]any)
	if len(shared) != 1 {
		t.Fatalf("expected 1 shared program visible to other user, got %d", len(shared))
	}
}

func TestUnshareProgram_success(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 1)`, uid, "Sharable")
	pid, _ := res.LastInsertId()

	c, w := newContext(uid, http.MethodPost, "/api/v1/programs/"+fmt.Sprint(pid)+"/unshare", nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.UnshareProgram(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	c2, w2 := newContext(other, http.MethodGet, "/api/v1/programs/shared", nil)
	th.ListSharedPrograms(c2)
	shared := decodeResponse(t, w2)["data"].([]any)
	if len(shared) != 0 {
		t.Fatalf("expected 0 shared programs visible after unshare, got %d", len(shared))
	}
}

func TestShareProgram_notOwner_404(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "Not Yours")
	pid, _ := res.LastInsertId()

	c, w := newContext(other, http.MethodPost, "/api/v1/programs/"+fmt.Sprint(pid)+"/share", nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.ShareProgram(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for non-owner share attempt, got %d", w.Code)
	}
}

func TestGetProgram_sharedReadableByOthers(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)
	exID := createTestExercise(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 1)`, uid, "Shared With All")
	pid, _ := res.LastInsertId()
	exRes, _ := db.DB.Exec(`INSERT INTO program_exercises (program_id, exercise_id, order_index) VALUES (?, ?, 0)`, pid, exID)
	peid, _ := exRes.LastInsertId()
	db.DB.Exec(`INSERT INTO program_sets (program_exercise_id, set_number, target_reps, target_weight) VALUES (?, 1, 5, 100)`, peid)

	c, w := newContext(other, http.MethodGet, "/api/v1/programs/"+fmt.Sprint(pid), nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.GetProgram(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for shared program cross-user read, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["owner_email"] != "test@example.com" {
		t.Errorf("expected owner_email 'test@example.com', got %v", data["owner_email"])
	}
	exercises := data["exercises"].([]any)
	if len(exercises) != 1 {
		t.Fatalf("expected 1 exercise in shared program read, got %d", len(exercises))
	}
}

func TestGetProgram_unsharedNotReadableByOthers(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "Still Private")
	pid, _ := res.LastInsertId()

	c, w := newContext(other, http.MethodGet, "/api/v1/programs/"+fmt.Sprint(pid), nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.GetProgram(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unshared cross-user read (privacy regression), got %d", w.Code)
	}
}

func TestGetProgram_ownerNoOwnerEmail(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 1)`, uid, "Mine")
	pid, _ := res.LastInsertId()

	c, w := newContext(uid, http.MethodGet, "/api/v1/programs/"+fmt.Sprint(pid), nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.GetProgram(c)

	data := decodeResponse(t, w)["data"].(map[string]any)
	if oe, ok := data["owner_email"]; ok && oe != "" && oe != nil {
		t.Errorf("expected no owner_email for own program, got %v", oe)
	}
}

func TestCopyProgram_success(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)
	exID := createTestExercise(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 1)`, uid, "Source Program")
	pid, _ := res.LastInsertId()
	exRes, _ := db.DB.Exec(`INSERT INTO program_exercises (program_id, exercise_id, order_index) VALUES (?, ?, 0)`, pid, exID)
	peid, _ := exRes.LastInsertId()
	db.DB.Exec(`INSERT INTO program_sets (program_exercise_id, set_number, target_reps, target_weight) VALUES (?, 1, 5, 100)`, peid)

	c, w := newContext(other, http.MethodPost, "/api/v1/programs/"+fmt.Sprint(pid)+"/copy", nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.CopyProgram(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	newID := int64(data["id"].(float64))
	if newID == pid {
		t.Fatal("copy should have a new id distinct from the source")
	}
	if data["user_id"].(float64) != float64(other) {
		t.Errorf("expected copy owned by copier, got user_id %v", data["user_id"])
	}
	if data["is_shared"] != false {
		t.Errorf("expected copy to not be shared, got %v", data["is_shared"])
	}
	exercises := data["exercises"].([]any)
	sets := exercises[0].(map[string]any)["sets"].([]any)
	if sets[0].(map[string]any)["target_weight"].(float64) != 100.0 {
		t.Errorf("expected copied set to carry source target_weight, got %v", sets[0].(map[string]any)["target_weight"])
	}

	// Mutate the copy; source must remain untouched.
	updateBody := map[string]any{
		"name": "Renamed Copy",
		"exercises": []map[string]any{
			{"exercise_id": exID, "sets": []map[string]any{{"set_number": 1, "target_reps": 5, "target_weight": 999.0}}},
		},
	}
	c2, w2 := newContext(other, http.MethodPut, "/api/v1/programs/"+fmt.Sprint(newID), updateBody)
	setParam(c2, "id", fmt.Sprint(newID))
	th.UpdateProgram(c2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 updating copy, got %d: %s", w2.Code, w2.Body.String())
	}

	var sourceWeight float64
	db.DB.QueryRow(`SELECT target_weight FROM program_sets WHERE program_exercise_id = ?`, peid).Scan(&sourceWeight)
	if sourceWeight != 100.0 {
		t.Errorf("source program was mutated by editing the copy: target_weight = %v", sourceWeight)
	}
}

func TestCopyProgram_notShared_404(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "Private Source")
	pid, _ := res.LastInsertId()

	c, w := newContext(other, http.MethodPost, "/api/v1/programs/"+fmt.Sprint(pid)+"/copy", nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.CopyProgram(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 copying an unshared program you don't own, got %d", w.Code)
	}
}

func TestCopyProgram_ownProgram_success(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "My Own")
	pid, _ := res.LastInsertId()

	c, w := newContext(uid, http.MethodPost, "/api/v1/programs/"+fmt.Sprint(pid)+"/copy", nil)
	setParam(c, "id", fmt.Sprint(pid))
	th.CopyProgram(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 copying your own unshared program, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListPrograms_stillOwnerOnly(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	db.DB.Exec(`INSERT INTO programs (user_id, name, is_shared) VALUES (?, ?, 1)`, other, "Their Shared")
	db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, other, "Their Private")

	c, w := newContext(uid, http.MethodGet, "/api/v1/programs", nil)
	th.ListPrograms(c)

	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 0 {
		t.Fatalf("expected 0 programs (other user's programs must never appear in My Programs), got %d", len(data))
	}
}

// A program's last_used_at comes from MAX(workouts.started_at), which SQLite
// returns as a plain string (aggregate expressions lose column type
// affinity) rather than a driver-typed time.Time — regression test for a bug
// where that broke the whole /programs?sort=smart response with a 500 once a
// workout actually referenced a program.
func TestListPrograms_smartSortIncludesLastUsed(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	res, _ := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, "PPL")
	pid, _ := res.LastInsertId()
	db.DB.Exec(
		`INSERT INTO workouts (user_id, name, program_id, started_at) VALUES (?, ?, ?, ?)`,
		uid, "Push Day", pid, "2026-07-15T18:00:00Z",
	)

	c, w := newContext(uid, http.MethodGet, "/api/v1/programs", nil)
	c.Request.URL.RawQuery = "sort=smart"
	th.ListPrograms(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected 1 program, got %d", len(data))
	}
	if lu := data[0].(map[string]any)["last_used_at"]; lu != "2026-07-15T18:00:00Z" {
		t.Errorf("expected last_used_at '2026-07-15T18:00:00Z', got %v", lu)
	}
}
