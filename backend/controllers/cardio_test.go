package controllers

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
)

func cardioSessionBody(externalID string, start time.Time) map[string]any {
	return map[string]any{
		"external_id":      externalID,
		"activity_type":    "running",
		"started_at":       start.Format(time.RFC3339),
		"ended_at":         start.Add(30 * time.Minute).Format(time.RFC3339),
		"duration_seconds": 1800,
		"distance_meters":  5000.0,
		"avg_heart_rate":   145,
		"calories":         320.5,
	}
}

func TestImportCardioSessions_createsAndReturnsSessions(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{cardioSessionBody("hc-1", start)},
	})
	th.ImportCardioSessions(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 1 {
		t.Errorf("imported = %v, want 1", data["imported"])
	}

	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	s := sessions[0].(map[string]any)
	if s["activity_type"] != "running" || s["external_id"] != "hc-1" {
		t.Errorf("session did not round-trip: %v", s)
	}
}

// The whole point of external_id: a sync job resubmits its batch every run
// without tracking what it already sent, so re-importing the same session
// must not create a duplicate row.
func TestImportCardioSessions_dedupesOnExternalID(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	body := map[string]any{"sessions": []map[string]any{cardioSessionBody("hc-dup", start)}}

	c, w := newContext(uid, "POST", "/cardio/import", body)
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("first import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "POST", "/cardio/import", body)
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("second import: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 0 {
		t.Errorf("second import should insert 0 new rows, got %v", data["imported"])
	}

	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("expected exactly 1 session after re-import, got %d", len(sessions))
	}
}

func TestImportCardioSessions_validation(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	cases := []struct {
		name string
		body map[string]any
		want int
	}{
		{"missing sessions", map[string]any{}, http.StatusUnprocessableEntity},
		{"missing external_id", map[string]any{
			"sessions": []map[string]any{{
				"activity_type": "running", "started_at": time.Now().Format(time.RFC3339),
				"ended_at": time.Now().Format(time.RFC3339), "duration_seconds": 100,
			}},
		}, http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, "POST", "/cardio/import", tc.body)
			th.ImportCardioSessions(c)
			if w.Code != tc.want {
				t.Errorf("expected %d, got %d: %s", tc.want, w.Code, w.Body.String())
			}
		})
	}
}

func TestGetCardioSession_scopesToOwner(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "other@example.com", "hashed")
	otherUID, _ := other.LastInsertId()

	start := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{cardioSessionBody("hc-owner", start)},
	})
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	id := sessions[0].(map[string]any)["id"].(float64)

	c, w = newContext(otherUID, "GET", fmt.Sprintf("/cardio/%d", int64(id)), nil)
	setParam(c, "id", fmt.Sprintf("%d", int64(id)))
	th.GetCardioSession(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("other user should not see this session: expected 404, got %d", w.Code)
	}
}

func TestDeleteCardioSession(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{cardioSessionBody("hc-del", start)},
	})
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	id := sessions[0].(map[string]any)["id"].(float64)

	c, w = newContext(uid, "DELETE", fmt.Sprintf("/cardio/%d", int64(id)), nil)
	setParam(c, "id", fmt.Sprintf("%d", int64(id)))
	th.DeleteCardioSession(c)
	if w.Code != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions = decodeResponse(t, w)["data"].([]any)
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions after delete, got %d", len(sessions))
	}
}
