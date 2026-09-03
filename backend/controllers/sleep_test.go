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

func TestGetSleepSessionDetail(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	start := time.Date(2026, 3, 4, 23, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/sleep/import", map[string]any{
		"sessions": []map[string]any{sleepSessionBody("sl-detail", start)},
	})
	th.ImportSleepSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import sleep: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	c, w = newContext(uid, "GET", "/sleep", nil)
	th.ListSleepSessions(c)
	id := int64(decodeResponse(t, w)["data"].([]any)[0].(map[string]any)["id"].(float64))

	// One HR sample inside the session window, one well outside it.
	c, w = newContext(uid, "POST", "/heart-rate/import", map[string]any{
		"samples": []map[string]any{
			heartRateSampleBody("hr-in", start.Add(time.Hour), 55),
			heartRateSampleBody("hr-out", start.Add(-24*time.Hour), 70),
		},
	})
	th.ImportHeartRateSamples(c)

	c, w = newContext(uid, "POST", "/health-metrics/import", map[string]any{
		"metrics": []map[string]any{
			healthMetricBody("hrv_rmssd", "hm-in", start.Add(2*time.Hour), 60.0),
			healthMetricBody("resting_heart_rate", "hm-rhr-in", start.Add(3*time.Hour), 50.0),
			healthMetricBody("hrv_rmssd", "hm-out", start.Add(-24*time.Hour), 40.0),
		},
	})
	th.ImportHealthMetrics(c)

	c, w = newContext(uid, "GET", fmt.Sprintf("/sleep/%d/detail", id), nil)
	setParam(c, "id", fmt.Sprintf("%d", id))
	th.GetSleepSessionDetail(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	samples := data["heart_rate_samples"].([]any)
	if len(samples) != 1 || samples[0].(map[string]any)["external_id"] != "hr-in" {
		t.Errorf("expected only the in-window HR sample, got %v", samples)
	}
	hrv := data["hrv_readings"].([]any)
	if len(hrv) != 1 || hrv[0].(map[string]any)["external_id"] != "hm-in" {
		t.Errorf("expected only the in-window HRV reading, got %v", hrv)
	}
	rhr := data["resting_hr_readings"].([]any)
	if len(rhr) != 1 || rhr[0].(map[string]any)["external_id"] != "hm-rhr-in" {
		t.Errorf("expected only the in-window resting-HR reading, got %v", rhr)
	}
}

func TestGetSleepTrend_dailyBucketsWithRestingHR(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	dayOne := time.Date(2026, 3, 4, 23, 0, 0, 0, time.UTC)
	dayTwo := dayOne.Add(24 * time.Hour)
	c, w := newContext(uid, "POST", "/sleep/import", map[string]any{
		"sessions": []map[string]any{
			sleepSessionBody("sl-trend-1", dayOne),
			sleepSessionBody("sl-trend-2", dayTwo),
		},
	})
	th.ImportSleepSessions(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import sleep: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	// -2h keeps each reading on the SAME UTC calendar date as its session's
	// started_at (23:00), so it buckets into that session's own day rather
	// than rolling into the next one.
	c, w = newContext(uid, "POST", "/health-metrics/import", map[string]any{
		"metrics": []map[string]any{
			healthMetricBody("resting_heart_rate", "hm-rhr-1", dayOne.Add(-2*time.Hour), 50.0),
			healthMetricBody("resting_heart_rate", "hm-rhr-2", dayTwo.Add(-2*time.Hour), 60.0),
		},
	})
	th.ImportHealthMetrics(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import health metrics: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/sleep/trend?bucket=day&from=2026-03-01&to=2026-03-10&tz_offset=0", nil)
	th.GetSleepTrend(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	points := decodeResponse(t, w)["data"].([]any)
	if len(points) != 2 {
		t.Fatalf("expected 2 daily buckets, got %d: %v", len(points), points)
	}
	// sleepSessionBody: 2h light, 2h deep, 4h rem = 480 total minutes/night.
	p1 := points[0].(map[string]any)
	if p1["avg_total_minutes"].(float64) != 480 {
		t.Errorf("avg_total_minutes = %v, want 480", p1["avg_total_minutes"])
	}
	if p1["avg_resting_hr"].(float64) != 50 {
		t.Errorf("avg_resting_hr = %v, want 50", p1["avg_resting_hr"])
	}
	p2 := points[1].(map[string]any)
	if p2["avg_resting_hr"].(float64) != 60 {
		t.Errorf("avg_resting_hr = %v, want 60", p2["avg_resting_hr"])
	}
}

func TestGetSleepTrend_invalidBucket(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, "GET", "/sleep/trend?bucket=month", nil)
	th.GetSleepTrend(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid bucket, got %d: %s", w.Code, w.Body.String())
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
