package controllers

import (
	"net/http"
	"testing"
	"time"
)

func TestGetProfile_defaultsWhenNoRow(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodGet, "/api/v1/profile", nil)
	th.GetProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	d := settingsData(t, w)
	if d["activity_level"] != "moderate" {
		t.Fatalf("activity_level = %v, want moderate", d["activity_level"])
	}
	assertNum(t, d, "age", 0)
	assertNum(t, d, "height_inches", 0)
	if d["birth_date"] != "" {
		t.Fatalf("birth_date = %v, want empty", d["birth_date"])
	}
}

func TestUpdateProfile_partialUpdatePersists(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	birthDate := time.Now().AddDate(-47, 0, 0).Format("2006-01-02")

	c, w := newContext(uid, http.MethodPut, "/api/v1/profile", map[string]any{
		"birth_date": birthDate, "sex": "male", "height_inches": 70, "activity_level": "moderate",
	})
	th.UpdateProfile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	c2, w2 := newContext(uid, http.MethodGet, "/api/v1/profile", nil)
	th.GetProfile(c2)
	d := settingsData(t, w2)
	assertNum(t, d, "age", 47)
	assertNum(t, d, "height_inches", 70)
	if d["sex"] != "male" {
		t.Fatalf("sex = %v, want male", d["sex"])
	}
	if d["birth_date"] != birthDate {
		t.Fatalf("birth_date = %v, want %v", d["birth_date"], birthDate)
	}
}

// A partial update that only touches one field (birth date) must not require
// — or clobber with a validation-rejected zero value — the other fields.
// Regression test for the reported bug: submitting the full form with an
// unset field (e.g. sex still "") used to fail validation and silently drop
// the whole update.
func TestUpdateProfile_partialUpdateOmittingOtherFieldsSucceeds(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	birthDate := time.Now().AddDate(-30, 0, 0).Format("2006-01-02")

	c, w := newContext(uid, http.MethodPut, "/api/v1/profile", map[string]any{"birth_date": birthDate})
	th.UpdateProfile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	c2, w2 := newContext(uid, http.MethodGet, "/api/v1/profile", nil)
	th.GetProfile(c2)
	d := settingsData(t, w2)
	assertNum(t, d, "age", 30)
	if d["activity_level"] != "moderate" {
		t.Fatalf("activity_level = %v, want default moderate to survive an omitted field", d["activity_level"])
	}
}

func TestUpdateProfile_rejectsInvalidSex(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPut, "/api/v1/profile", map[string]any{"sex": "unknown"})
	th.UpdateProfile(c)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateProfile_rejectsEmptyStringSex(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// A non-nil pointer to "" is NOT treated as absent by validator's
	// omitempty — the frontend must omit the key entirely rather than send
	// an empty string for an unset field. This test documents that contract.
	c, w := newContext(uid, http.MethodPut, "/api/v1/profile", map[string]any{"sex": ""})
	th.UpdateProfile(c)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for empty-string sex, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetProfile_computesBMIFromLatestWeight(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	birthDate := time.Now().AddDate(-47, 0, 0).Format("2006-01-02")

	c, w := newContext(uid, http.MethodPut, "/api/v1/profile", map[string]any{
		"birth_date": birthDate, "sex": "male", "height_inches": 70, "activity_level": "moderate",
	})
	th.UpdateProfile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	wc, ww := newContext(uid, http.MethodPost, "/api/v1/weight", map[string]any{"weight": 230})
	th.LogWeight(wc)
	if ww.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", ww.Code, ww.Body.String())
	}

	c2, w2 := newContext(uid, http.MethodGet, "/api/v1/profile", nil)
	th.GetProfile(c2)
	d := settingsData(t, w2)
	bmi, ok := d["bmi"].(map[string]any)
	if !ok {
		t.Fatalf("bmi is not an object: %v", d["bmi"])
	}
	got, _ := bmi["bmi"].(float64)
	if got < 32 || got > 34 {
		t.Fatalf("bmi = %v, want ~33", got)
	}
}
