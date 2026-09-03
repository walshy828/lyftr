package controllers

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
)

func sleepSessionBody(externalID string, start time.Time) map[string]any {
	return map[string]any{
		"external_id": externalID,
		"started_at":  start.Format(time.RFC3339),
		"ended_at":    start.Add(8 * time.Hour).Format(time.RFC3339),
		"stages": []map[string]any{
			{"stage_type": "light", "started_at": start.Format(time.RFC3339), "ended_at": start.Add(2 * time.Hour).Format(time.RFC3339)},
			{"stage_type": "deep", "started_at": start.Add(2 * time.Hour).Format(time.RFC3339), "ended_at": start.Add(4 * time.Hour).Format(time.RFC3339)},
			{"stage_type": "rem", "started_at": start.Add(4 * time.Hour).Format(time.RFC3339), "ended_at": start.Add(8 * time.Hour).Format(time.RFC3339)},
		},
	}
}

func TestImportSleepSessions_createsAndReturnsSessionsWithStages(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 23, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/sleep/import", map[string]any{
		"sessions": []map[string]any{sleepSessionBody("sl-1", start)},
	})
	th.ImportSleepSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 1 {
		t.Errorf("imported = %v, want 1", data["imported"])
	}

	c, w = newContext(uid, "GET", "/sleep", nil)
	th.ListSleepSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	s := sessions[0].(map[string]any)
	stages := s["stages"].([]any)
	if len(stages) != 3 {
		t.Errorf("expected 3 stages, got %d: %v", len(stages), stages)
	}
}

// A resubmitted session must replace its stages wholesale, not append to them.
func TestImportSleepSessions_replacesStagesOnResubmit(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 23, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/sleep/import", map[string]any{
		"sessions": []map[string]any{sleepSessionBody("sl-dup", start)},
	})
	th.ImportSleepSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("first import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	changed := sleepSessionBody("sl-dup", start)
	changed["stages"] = []map[string]any{
		{"stage_type": "awake", "started_at": start.Format(time.RFC3339), "ended_at": start.Add(time.Hour).Format(time.RFC3339)},
	}
	c, w = newContext(uid, "POST", "/sleep/import", map[string]any{
		"sessions": []map[string]any{changed},
	})
	th.ImportSleepSessions(c)
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 0 || data["updated"].(float64) != 1 {
		t.Errorf("second import: imported=%v updated=%v, want 0/1", data["imported"], data["updated"])
	}

	c, w = newContext(uid, "GET", "/sleep", nil)
	th.ListSleepSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("expected exactly 1 session after re-import, got %d", len(sessions))
	}
	stages := sessions[0].(map[string]any)["stages"].([]any)
	if len(stages) != 1 || stages[0].(map[string]any)["stage_type"] != "awake" {
		t.Errorf("stages were not replaced wholesale: %v", stages)
	}
}

func TestGetSleepSession_scopesToOwner(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "other@example.com", "hashed")
	otherUID, _ := other.LastInsertId()

	start := time.Date(2026, 3, 4, 23, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/sleep/import", map[string]any{
		"sessions": []map[string]any{sleepSessionBody("sl-owner", start)},
	})
	th.ImportSleepSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/sleep", nil)
	th.ListSleepSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	id := sessions[0].(map[string]any)["id"].(float64)

	c, w = newContext(otherUID, "GET", fmt.Sprintf("/sleep/%d", int64(id)), nil)
	setParam(c, "id", fmt.Sprintf("%d", int64(id)))
	th.GetSleepSession(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("other user should not see this session: expected 404, got %d", w.Code)
	}
}

func TestGetSleepDailySummary(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 23, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/sleep/import", map[string]any{
		"sessions": []map[string]any{sleepSessionBody("sl-summary", start)},
	})
	th.ImportSleepSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/sleep/daily", nil)
	th.GetSleepDailySummary(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	days := decodeResponse(t, w)["data"].([]any)
	if len(days) != 1 {
		t.Fatalf("expected 1 day, got %d", len(days))
	}
	d := days[0].(map[string]any)
	// sleepSessionBody: 2h light, 2h deep, 4h rem = 480 total minutes.
	if d["total_minutes"].(float64) != 480 {
		t.Errorf("total_minutes = %v, want 480", d["total_minutes"])
	}
	if d["light_minutes"].(float64) != 120 || d["deep_minutes"].(float64) != 120 || d["rem_minutes"].(float64) != 240 {
		t.Errorf("unexpected stage minutes: %v", d)
	}
	if d["session_count"].(float64) != 1 {
		t.Errorf("session_count = %v, want 1", d["session_count"])
	}
}

func TestImportSleepSessions_validation(t *testing.T) {
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
				"started_at": time.Now().Format(time.RFC3339), "ended_at": time.Now().Format(time.RFC3339),
			}},
		}, http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, "POST", "/sleep/import", tc.body)
			th.ImportSleepSessions(c)
			if w.Code != tc.want {
				t.Errorf("expected %d, got %d: %s", tc.want, w.Code, w.Body.String())
			}
		})
	}
}
