package controllers

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/stores"
)

func TestCreateExercise_withPhotoAndMuscles(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	c, w := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{
		"name":              "Sled Push",
		"muscle_group":      "quadriceps",
		"secondary_muscles": []string{"glutes", "hamstrings"},
		"equipment":         "other",
		"description":       "1. Load the sled\n2. Drive through your legs",
		"image_url":         "data:image/jpeg;base64,abc123",
	})
	h.CreateExercise(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	body := decodeResponse(t, w)["data"].(map[string]any)
	if body["source"] != "custom" {
		t.Errorf("expected source=custom, got %v", body["source"])
	}
	if body["description"] == "" {
		t.Errorf("expected description to persist")
	}
	if body["image_url"] != "data:image/jpeg;base64,abc123" {
		t.Errorf("expected image_url to persist, got %v", body["image_url"])
	}
	secondary, _ := body["secondary_muscles"].([]any)
	if len(secondary) != 2 {
		t.Errorf("expected 2 secondary muscles, got %v", body["secondary_muscles"])
	}
}

func TestCreateExercise_timedRoundTrips(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	c, w := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{
		"name":                     "Plank",
		"muscle_group":             "core",
		"is_timed":                 true,
		"default_duration_seconds": 90,
	})
	h.CreateExercise(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	created := decodeResponse(t, w)["data"].(map[string]any)
	if created["is_timed"] != true {
		t.Errorf("expected is_timed=true, got %v", created["is_timed"])
	}
	if created["default_duration_seconds"] != float64(90) {
		t.Errorf("expected default_duration_seconds=90, got %v", created["default_duration_seconds"])
	}
	id := int64(created["id"].(float64))

	upd, uw := newContext(uid, http.MethodPut, "/api/v1/exercises/"+strconv.FormatInt(id, 10), map[string]any{
		"name":                     "Plank",
		"muscle_group":             "core",
		"is_timed":                 false,
		"default_duration_seconds": 90,
	})
	setParam(upd, "id", strconv.FormatInt(id, 10))
	h.UpdateExercise(upd)
	if uw.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", uw.Code, uw.Body.String())
	}
	updated := decodeResponse(t, uw)["data"].(map[string]any)
	if updated["is_timed"] != false {
		t.Errorf("expected is_timed=false after clearing, got %v", updated["is_timed"])
	}
	if updated["default_duration_seconds"] != nil {
		t.Errorf("expected default_duration_seconds cleared to 0 (omitted as zero value), got %v", updated["default_duration_seconds"])
	}
}

func TestCreateExercise_timedDefaultsDurationWhenUnset(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	c, w := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{
		"name":         "Wall Sit",
		"muscle_group": "quadriceps",
		"is_timed":     true,
	})
	h.CreateExercise(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	created := decodeResponse(t, w)["data"].(map[string]any)
	if created["default_duration_seconds"] != float64(30) {
		t.Errorf("expected default_duration_seconds to default to 30, got %v", created["default_duration_seconds"])
	}
}

func TestCreateExercise_imageTooLarge(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	huge := make([]byte, maxExerciseImageBytes+1)
	for i := range huge {
		huge[i] = 'a'
	}
	c, w := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{
		"name":         "Big Photo Exercise",
		"muscle_group": "chest",
		"image_url":    string(huge),
	})
	h.CreateExercise(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateExercise_ok(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	createC, createW := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{
		"name": "Original Name", "muscle_group": "chest",
	})
	h.CreateExercise(createC)
	created := decodeResponse(t, createW)["data"].(map[string]any)
	id := int64(created["id"].(float64))

	c, w := newContext(uid, http.MethodPut, "/api/v1/exercises/"+strconv.FormatInt(id, 10), map[string]any{
		"name":              "Updated Name",
		"muscle_group":      "back",
		"secondary_muscles": []string{"lats"},
		"description":       "step 1",
	})
	setParam(c, "id", strconv.FormatInt(id, 10))
	h.UpdateExercise(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	body := decodeResponse(t, w)["data"].(map[string]any)
	if body["name"] != "Updated Name" || body["muscle_group"] != "back" {
		t.Errorf("update did not persist: %v", body)
	}
}

func TestUpdateExercise_rejectsNonCustom(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)
	id := createTestExerciseWithSource(t, "Library Exercise", "free")

	c, w := newContext(uid, http.MethodPut, "/api/v1/exercises/"+strconv.FormatInt(id, 10), map[string]any{
		"name": "Hacked Name", "muscle_group": "chest",
	})
	setParam(c, "id", strconv.FormatInt(id, 10))
	h.UpdateExercise(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateExercise_duplicateName(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	c1, w1 := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{"name": "Exercise A", "muscle_group": "chest"})
	h.CreateExercise(c1)

	c2, w2 := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{"name": "Exercise B", "muscle_group": "chest"})
	h.CreateExercise(c2)
	bID := int64(decodeResponse(t, w2)["data"].(map[string]any)["id"].(float64))
	_ = decodeResponse(t, w1)

	c, w := newContext(uid, http.MethodPut, "/api/v1/exercises/"+strconv.FormatInt(bID, 10), map[string]any{
		"name": "Exercise A", "muscle_group": "chest",
	})
	setParam(c, "id", strconv.FormatInt(bID, 10))
	h.UpdateExercise(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteExercise_ok(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	createC, createW := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{
		"name": "Deletable Exercise", "muscle_group": "chest",
	})
	h.CreateExercise(createC)
	id := int64(decodeResponse(t, createW)["data"].(map[string]any)["id"].(float64))

	c, w := newContext(uid, http.MethodDelete, "/api/v1/exercises/"+strconv.FormatInt(id, 10), nil)
	setParam(c, "id", strconv.FormatInt(id, 10))
	h.DeleteExercise(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	getC, getW := newContext(uid, http.MethodGet, "/api/v1/exercises/"+strconv.FormatInt(id, 10), nil)
	setParam(getC, "id", strconv.FormatInt(id, 10))
	h.GetExercise(getC)
	if getW.Code != http.StatusNotFound {
		t.Fatalf("expected exercise to be gone, got %d", getW.Code)
	}
}

func TestDeleteExercise_rejectsNonCustom(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)
	id := createTestExerciseWithSource(t, "Library Exercise 2", "free")

	c, w := newContext(uid, http.MethodDelete, "/api/v1/exercises/"+strconv.FormatInt(id, 10), nil)
	setParam(c, "id", strconv.FormatInt(id, 10))
	h.DeleteExercise(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteExercise_blockedWhenInUse(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	h := NewHandler(stores.New(db.DB), nil)

	createC, createW := newContext(uid, http.MethodPost, "/api/v1/exercises", map[string]any{
		"name": "In Use Exercise", "muscle_group": "chest",
	})
	h.CreateExercise(createC)
	id := int64(decodeResponse(t, createW)["data"].(map[string]any)["id"].(float64))

	seedWorkoutWithSet(t, uid, id, 100, 5, 0)

	c, w := newContext(uid, http.MethodDelete, "/api/v1/exercises/"+strconv.FormatInt(id, 10), nil)
	setParam(c, "id", strconv.FormatInt(id, 10))
	h.DeleteExercise(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}
