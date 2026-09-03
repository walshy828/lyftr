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
// must not create a duplicate row — and if the resubmitted session's fields
// changed (e.g. the user recategorized it in Health Connect), the existing
// row must be overwritten rather than silently ignored.
func TestImportCardioSessions_upsertsOnResubmit(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	body := map[string]any{"sessions": []map[string]any{cardioSessionBody("hc-dup", start)}}

	c, w := newContext(uid, "POST", "/cardio/import", body)
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("first import: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 1 || data["updated"].(float64) != 0 {
		t.Errorf("first import: imported=%v updated=%v, want 1/0", data["imported"], data["updated"])
	}

	changed := cardioSessionBody("hc-dup", start)
	changed["activity_type"] = "walking"
	changed["distance_meters"] = 3200.0
	changed["calories"] = 210.0
	c, w = newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{changed},
	})
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("second import: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data = decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 0 || data["updated"].(float64) != 1 {
		t.Errorf("second import: imported=%v updated=%v, want 0/1", data["imported"], data["updated"])
	}

	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("expected exactly 1 session after re-import, got %d", len(sessions))
	}
	s := sessions[0].(map[string]any)
	if s["activity_type"] != "walking" || s["distance_meters"].(float64) != 3200.0 {
		t.Errorf("existing row was not overwritten with resubmitted values: %v", s)
	}
}

// A resubmitted session's started_at can shift to a different calendar day
// (e.g. Health Connect corrects the session's timing). Since streaks are
// computed live from cardio_sessions on every request, the shift must be
// reflected immediately with no stale or duplicated streak day.
func TestImportCardioSessions_upsertShiftsStreakDay(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	dayOne := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{cardioSessionBody("hc-shift", dayOne)},
	})
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/cardio/stats?from=2026-03-01&to=2026-03-10&tz_offset=0&include=daily", nil)
	th.GetCardioStats(c)
	data := decodeResponse(t, w)["data"].(map[string]any)
	daily := data["daily"].([]any)
	if len(daily) != 1 || daily[0].(map[string]any)["date"] != "2026-03-04" {
		t.Fatalf("expected a single daily row on 2026-03-04, got %v", daily)
	}

	dayTwo := dayOne.Add(24 * time.Hour)
	shifted := cardioSessionBody("hc-shift", dayTwo)
	c, w = newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{shifted},
	})
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("re-import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/cardio/stats?from=2026-03-01&to=2026-03-10&tz_offset=0&include=daily", nil)
	th.GetCardioStats(c)
	data = decodeResponse(t, w)["data"].(map[string]any)
	daily = data["daily"].([]any)
	if len(daily) != 1 || daily[0].(map[string]any)["date"] != "2026-03-05" {
		t.Fatalf("expected the single daily row to move to 2026-03-05, got %v", daily)
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

// avg_cadence must round-trip through import/get and be omitted (null) for
// sessions that never reported it.
func TestImportCardioSessions_avgCadenceRoundTrips(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	withCadence := cardioSessionBody("hc-cadence", start)
	withCadence["avg_cadence"] = 88.5
	noCadence := cardioSessionBody("hc-no-cadence", start.Add(time.Hour))

	c, w := newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{withCadence, noCadence},
	})
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	for _, s := range sessions {
		sess := s.(map[string]any)
		switch sess["external_id"] {
		case "hc-cadence":
			if sess["avg_cadence"].(float64) != 88.5 {
				t.Errorf("avg_cadence = %v, want 88.5", sess["avg_cadence"])
			}
		case "hc-no-cadence":
			if _, ok := sess["avg_cadence"]; ok {
				t.Errorf("expected avg_cadence to be omitted when not reported, got %v", sess["avg_cadence"])
			}
		}
	}
}

func TestGetCardioSessionZones(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{cardioSessionBody("hc-zones", start)},
	})
	th.ImportCardioSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import cardio: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	id := int64(sessions[0].(map[string]any)["id"].(float64))

	// max_hr=200: 100bpm=50% (zone1), 190bpm=95% (zone5).
	c, w = newContext(uid, "POST", "/heart-rate/import", map[string]any{
		"samples": []map[string]any{
			heartRateSampleBody("hr-zone-1", start.Add(time.Minute), 100),
			heartRateSampleBody("hr-zone-2", start.Add(10*time.Minute), 190),
			heartRateSampleBody("hr-zone-3", start.Add(20*time.Minute), 190),
		},
	})
	th.ImportHeartRateSamples(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import hr: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", fmt.Sprintf("/cardio/%d/zones?max_hr=200", id), nil)
	setParam(c, "id", fmt.Sprintf("%d", id))
	th.GetCardioSessionZones(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["max_observed_bpm"].(float64) != 190 {
		t.Errorf("max_observed_bpm = %v, want 190", data["max_observed_bpm"])
	}
	zones := data["zones"].(map[string]any)
	if zones["zone_1_minutes"].(float64) != 9 {
		t.Errorf("zone_1_minutes = %v, want 9", zones["zone_1_minutes"])
	}
	if zones["zone_5_minutes"].(float64) != 10 {
		t.Errorf("zone_5_minutes = %v, want 10", zones["zone_5_minutes"])
	}
}

func TestGetCardioSessionZones_requiresMaxHROrBirthDate(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/cardio/import", map[string]any{
		"sessions": []map[string]any{cardioSessionBody("hc-no-maxhr", start)},
	})
	th.ImportCardioSessions(c)
	c, w = newContext(uid, "GET", "/cardio", nil)
	th.ListCardioSessions(c)
	sessions := decodeResponse(t, w)["data"].([]any)
	id := int64(sessions[0].(map[string]any)["id"].(float64))

	c, w = newContext(uid, "GET", fmt.Sprintf("/cardio/%d/zones", id), nil)
	setParam(c, "id", fmt.Sprintf("%d", id))
	th.GetCardioSessionZones(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 with no max_hr and no birth date, got %d: %s", w.Code, w.Body.String())
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
