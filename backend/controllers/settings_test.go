package controllers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// settingsData pulls the UserSettings object out of a {"data": ...} envelope.
func settingsData(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	resp := decodeResponse(t, w)
	d, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatalf("data is not an object: %v", resp["data"])
	}
	return d
}

func assertNum(t *testing.T, d map[string]any, key string, want float64) {
	t.Helper()
	got, ok := d[key].(float64)
	if !ok {
		t.Fatalf("%s is not a number: %v", key, d[key])
	}
	if got != want {
		t.Fatalf("%s = %v, want %v", key, got, want)
	}
}

func TestGetSettings_defaultsWhenNoRow(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodGet, "/api/v1/settings", nil)
	th.GetSettings(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	d := settingsData(t, w)
	assertNum(t, d, "calorie_target", 2000)
	assertNum(t, d, "protein_target", 150)
	assertNum(t, d, "carb_target", 250)
	assertNum(t, d, "fat_target", 65)
	if d["weight_unit"] != "lbs" {
		t.Fatalf("weight_unit = %v, want lbs", d["weight_unit"])
	}
}

// The #37 regression: a weight-unit-only PATCH on a user with no settings row
// must land the targets on their defaults, not zero them.
func TestUpdateSettings_partialUpdateSeedsDefaultsNotZeros(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPut, "/api/v1/settings", map[string]any{"weight_unit": "kg"})
	th.UpdateSettings(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["weight_unit"] != "kg" {
		t.Fatalf("weight_unit = %v, want kg", d["weight_unit"])
	}
	assertNum(t, d, "calorie_target", 2000)
	assertNum(t, d, "protein_target", 150)
	assertNum(t, d, "carb_target", 250)
	assertNum(t, d, "fat_target", 65)
}

// A partial update over an EXISTING custom row leaves the omitted fields intact.
func TestUpdateSettings_partialUpdatePreservesCustomTargets(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// Set custom targets.
	c, w := newContext(uid, http.MethodPut, "/api/v1/settings", map[string]any{
		"calorie_target": 1800, "protein_target": 200, "carb_target": 100, "fat_target": 50,
	})
	th.UpdateSettings(c)
	if w.Code != http.StatusOK {
		t.Fatalf("setup expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Change only the weight unit — the custom targets must survive.
	c, w = newContext(uid, http.MethodPut, "/api/v1/settings", map[string]any{"weight_unit": "kg"})
	th.UpdateSettings(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["weight_unit"] != "kg" {
		t.Fatalf("weight_unit = %v, want kg", d["weight_unit"])
	}
	assertNum(t, d, "calorie_target", 1800)
	assertNum(t, d, "protein_target", 200)
	assertNum(t, d, "carb_target", 100)
	assertNum(t, d, "fat_target", 50)
}

// Invalid values are rejected — the request tags are now actually enforced.
func TestUpdateSettings_rejectsInvalid(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	cases := []map[string]any{
		{"weight_unit": "stone"}, // not lbs/kg
		{"protein_target": -5},   // negative
		{"calorie_target": -1},
	}
	for _, body := range cases {
		c, w := newContext(uid, http.MethodPut, "/api/v1/settings", body)
		th.UpdateSettings(c)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %v: expected 400, got %d: %s", body, w.Code, w.Body.String())
		}
	}

	// The rejected requests must not have created/mutated a row.
	c, w := newContext(uid, http.MethodGet, "/api/v1/settings", nil)
	th.GetSettings(c)
	d := settingsData(t, w)
	assertNum(t, d, "protein_target", 150)
	if d["weight_unit"] != "lbs" {
		t.Fatalf("weight_unit = %v, want lbs (unchanged)", d["weight_unit"])
	}
}

// Food preferences persist and survive a later partial update of other fields.
func TestUpdateSettings_foodPreferences(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPut, "/api/v1/settings", map[string]any{
		"food_allergies": "avocado", "food_dislikes": "cilantro", "food_likes": "sushi",
	})
	th.UpdateSettings(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["food_allergies"] != "avocado" || d["food_dislikes"] != "cilantro" || d["food_likes"] != "sushi" {
		t.Fatalf("preferences not persisted: %v", d)
	}
	// Untouched targets seeded with defaults, not zeroed.
	assertNum(t, d, "calorie_target", 2000)

	// A partial update of another field leaves the preferences intact...
	c, w = newContext(uid, http.MethodPut, "/api/v1/settings", map[string]any{"weight_unit": "kg"})
	th.UpdateSettings(c)
	d = settingsData(t, w)
	if d["food_allergies"] != "avocado" {
		t.Fatalf("food_allergies = %v, want avocado (preserved)", d["food_allergies"])
	}

	// ...and an explicit empty string clears a preference.
	c, w = newContext(uid, http.MethodPut, "/api/v1/settings", map[string]any{"food_dislikes": ""})
	th.UpdateSettings(c)
	d = settingsData(t, w)
	if d["food_dislikes"] != "" {
		t.Fatalf("food_dislikes = %v, want cleared", d["food_dislikes"])
	}
	if d["food_allergies"] != "avocado" {
		t.Fatalf("food_allergies = %v, want avocado (preserved)", d["food_allergies"])
	}
}

// An explicit 0 is a real value (the pointer distinguishes it from "absent"),
// so it must be stored while other omitted fields keep their values.
func TestUpdateSettings_explicitZeroRespected(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPut, "/api/v1/settings", map[string]any{"protein_target": 0})
	th.UpdateSettings(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	assertNum(t, d, "protein_target", 0)
	// Untouched fields stay on their defaults.
	assertNum(t, d, "calorie_target", 2000)
	assertNum(t, d, "carb_target", 250)
	assertNum(t, d, "fat_target", 65)
}
