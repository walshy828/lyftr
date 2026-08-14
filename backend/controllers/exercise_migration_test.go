package controllers

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/seed"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/vision"
)

func createTestExerciseWithSource(t *testing.T, name, source string) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO exercises (name, muscle_group, category, source, source_id) VALUES (?, 'chest', 'strength', ?, ?)`,
		name, source, name,
	)
	if err != nil {
		t.Fatalf("create test exercise: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func TestPreviewExerciseMigration_notConfigured(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	c, w := newContext(uid, http.MethodPost, "/api/v1/admin/exercise-migration/preview", map[string]any{"to_source": "gymvisual"})
	h.PreviewExerciseMigration(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPreviewExerciseMigration_sameSourceRejected(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), &fakeVisionProvider{})

	c, w := newContext(uid, http.MethodPost, "/api/v1/admin/exercise-migration/preview", map[string]any{"to_source": "free"})
	h.PreviewExerciseMigration(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestExerciseMigration_previewThenConfirm_repointsAndPrunes(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// An in-use "free" exercise (referenced by a workout) and an unused one
	// (no history) — only the referenced one should need migrating, and only
	// it should show up in InUseExercises/the preview.
	usedID := createTestExerciseWithSource(t, "Barbell Bench Press", "free")
	createTestExerciseWithSource(t, "Unused Free Exercise", "free")

	res, _ := db.DB.Exec(`INSERT INTO workouts (user_id, name, started_at) VALUES (?, 'Push Day', '2026-01-01')`, uid)
	workoutID, _ := res.LastInsertId()
	db.DB.Exec(`INSERT INTO workout_exercises (workout_id, exercise_id, order_index) VALUES (?, ?, 0)`, workoutID, usedID)

	prevCatalog, prevBySource := seed.FetchCatalogHook, seed.FetchBySourceHook
	t.Cleanup(func() { seed.FetchCatalogHook, seed.FetchBySourceHook = prevCatalog, prevBySource })

	seed.FetchCatalogHook = func(source string) ([]seed.CatalogItem, error) {
		return []seed.CatalogItem{{Name: "barbell bench press v.2", MuscleGroup: "chest", Equipment: "barbell", Category: "strength"}}, nil
	}

	fake := &fakeVisionProvider{
		exerciseMatches: []vision.ExerciseMatch{
			{OldExerciseID: usedID, MatchedName: "barbell bench press v.2", Confidence: "high", Reasoning: "same movement"},
		},
	}
	h := NewHandler(stores.New(db.DB), fake)

	// Preview.
	c, w := newContext(uid, http.MethodPost, "/api/v1/admin/exercise-migration/preview", map[string]any{"to_source": "gymvisual"})
	h.PreviewExerciseMigration(c)
	if w.Code != http.StatusOK {
		t.Fatalf("preview: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	migrationID := int64(data["id"].(float64))
	mapping := data["mapping"].([]any)
	if len(mapping) != 1 {
		t.Fatalf("expected exactly 1 in-use exercise proposed (the referenced one), got %d", len(mapping))
	}
	entry := mapping[0].(map[string]any)
	if entry["matched_name"] != "barbell bench press v.2" || entry["confidence"] != "high" {
		t.Fatalf("unexpected proposal entry: %+v", entry)
	}
	if fake.matchReq.InUse[0].ID != usedID {
		t.Errorf("expected the provider to be asked about the referenced exercise, got %+v", fake.matchReq.InUse)
	}

	// Stub the target library's seed so Confirm's SyncTargetLibrary doesn't
	// hit the network — it just needs to insert one gymvisual-sourced row
	// with the matched name so ExerciseIDByName can resolve it.
	seed.FetchBySourceHook = func(source string) ([]seed.SeedItem, error) { return nil, nil }
	db.DB.Exec(`INSERT INTO exercises (name, muscle_group, category, source, source_id) VALUES (?, 'chest', 'strength', 'gymvisual', 'gv-1')`, "barbell bench press v.2")

	// Confirm.
	confirmBody := map[string]any{
		"mapping": []map[string]any{
			{"old_exercise_id": usedID, "old_name": "Barbell Bench Press", "matched_name": "barbell bench press v.2", "confidence": "high", "leave_unmigrated": false},
		},
	}
	c2, w2 := newContext(uid, http.MethodPost, "/api/v1/admin/exercise-migration/1/confirm", confirmBody)
	setParam(c2, "id", strconv.FormatInt(migrationID, 10))
	c2.Set("user_email", "admin@example.com")
	h.ConfirmExerciseMigration(c2)
	if w2.Code != http.StatusOK {
		t.Fatalf("confirm: expected 200, got %d: %s", w2.Code, w2.Body.String())
	}

	// The workout's exercise_id must now point at the new (gymvisual) row.
	var newExerciseSource string
	var newExerciseID int64
	db.DB.QueryRow(`SELECT exercise_id FROM workout_exercises WHERE workout_id = ?`, workoutID).Scan(&newExerciseID)
	db.DB.QueryRow(`SELECT source FROM exercises WHERE id = ?`, newExerciseID).Scan(&newExerciseSource)
	if newExerciseSource != "gymvisual" {
		t.Errorf("expected workout_exercises to be repointed to a gymvisual row, got source %q", newExerciseSource)
	}

	// The old referenced exercise row should be gone (pruned); the unused one
	// (never referenced, but also never mapped) should also be gone since it
	// was unreferenced and not lyftr-native — pruneUnreferenced semantics.
	var oldCount int
	db.DB.QueryRow(`SELECT COUNT(*) FROM exercises WHERE id = ?`, usedID).Scan(&oldCount)
	if oldCount != 0 {
		t.Errorf("expected the old migrated exercise row to be pruned, still found %d", oldCount)
	}

	// Migration record finalized.
	record, err := h.s.ExerciseMigration.GetMigration(migrationID)
	if err != nil {
		t.Fatalf("get migration: %v", err)
	}
	if record.Status != "applied" {
		t.Errorf("expected status applied, got %q", record.Status)
	}
	if record.AppliedBy != "admin@example.com" {
		t.Errorf("expected applied_by to be set, got %q", record.AppliedBy)
	}
}

func TestConfirmExerciseMigration_requiresResolutionForEveryRow(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	usedID := createTestExerciseWithSource(t, "Mystery Exercise", "free")

	h := NewHandler(stores.New(db.DB), &fakeVisionProvider{})
	id, err := h.s.ExerciseMigration.SaveProposal("free", "gymvisual", []stores.MigrationMappingEntry{
		{OldExerciseID: usedID, OldName: "Mystery Exercise", Confidence: "low"},
	})
	if err != nil {
		t.Fatalf("save proposal: %v", err)
	}

	// matched_name empty AND leave_unmigrated false — must be rejected rather
	// than silently orphaning the exercise's history.
	body := map[string]any{
		"mapping": []map[string]any{
			{"old_exercise_id": usedID, "old_name": "Mystery Exercise", "matched_name": "", "confidence": "low", "leave_unmigrated": false},
		},
	}
	c, w := newContext(uid, http.MethodPost, "/api/v1/admin/exercise-migration/1/confirm", body)
	setParam(c, "id", strconv.FormatInt(id, 10))
	h.ConfirmExerciseMigration(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestConfirmExerciseMigration_leaveUnmigratedPreservesOldRow(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	usedID := createTestExerciseWithSource(t, "No Good Match", "free")
	res, _ := db.DB.Exec(`INSERT INTO workouts (user_id, name, started_at) VALUES (?, 'Day', '2026-01-01')`, uid)
	workoutID, _ := res.LastInsertId()
	db.DB.Exec(`INSERT INTO workout_exercises (workout_id, exercise_id, order_index) VALUES (?, ?, 0)`, workoutID, usedID)

	prevBySource := seed.FetchBySourceHook
	seed.FetchBySourceHook = func(source string) ([]seed.SeedItem, error) { return nil, nil }
	t.Cleanup(func() { seed.FetchBySourceHook = prevBySource })

	h := NewHandler(stores.New(db.DB), &fakeVisionProvider{})
	id, err := h.s.ExerciseMigration.SaveProposal("free", "gymvisual", []stores.MigrationMappingEntry{
		{OldExerciseID: usedID, OldName: "No Good Match", Confidence: "low"},
	})
	if err != nil {
		t.Fatalf("save proposal: %v", err)
	}

	body := map[string]any{
		"mapping": []map[string]any{
			{"old_exercise_id": usedID, "old_name": "No Good Match", "matched_name": "", "confidence": "low", "leave_unmigrated": true},
		},
	}
	c, w := newContext(uid, http.MethodPost, "/api/v1/admin/exercise-migration/1/confirm", body)
	setParam(c, "id", strconv.FormatInt(id, 10))
	h.ConfirmExerciseMigration(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var count int
	db.DB.QueryRow(`SELECT COUNT(*) FROM exercises WHERE id = ?`, usedID).Scan(&count)
	if count != 1 {
		t.Errorf("expected the unmigrated exercise row to survive, found %d", count)
	}
	var exerciseID int64
	db.DB.QueryRow(`SELECT exercise_id FROM workout_exercises WHERE workout_id = ?`, workoutID).Scan(&exerciseID)
	if exerciseID != usedID {
		t.Errorf("expected workout_exercises to still point at the original exercise, got %d want %d", exerciseID, usedID)
	}
}
