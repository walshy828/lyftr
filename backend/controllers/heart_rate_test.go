package controllers

import (
	"net/http"
	"testing"
	"time"
)

func heartRateSampleBody(externalID string, at time.Time, bpm int) map[string]any {
	return map[string]any{
		"external_id": externalID,
		"recorded_at": at.Format(time.RFC3339),
		"bpm":         bpm,
	}
}

func TestImportHeartRateSamples_createsAndReturnsSamples(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	at := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/heart-rate/import", map[string]any{
		"samples": []map[string]any{heartRateSampleBody("hr-1", at, 72)},
	})
	th.ImportHeartRateSamples(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 1 {
		t.Errorf("imported = %v, want 1", data["imported"])
	}

	c, w = newContext(uid, "GET", "/heart-rate", nil)
	th.ListHeartRateSamples(c)
	samples := decodeResponse(t, w)["data"].([]any)
	if len(samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(samples))
	}
	s := samples[0].(map[string]any)
	if s["bpm"].(float64) != 72 || s["external_id"] != "hr-1" {
		t.Errorf("sample did not round-trip: %v", s)
	}
}

// Mirrors cardio's resubmit-safe upsert test: a sync job resubmits the same
// window every run, so re-importing must overwrite, not duplicate.
func TestImportHeartRateSamples_upsertsOnResubmit(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	at := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/heart-rate/import", map[string]any{
		"samples": []map[string]any{heartRateSampleBody("hr-dup", at, 70)},
	})
	th.ImportHeartRateSamples(c)
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 1 || data["updated"].(float64) != 0 {
		t.Errorf("first import: imported=%v updated=%v, want 1/0", data["imported"], data["updated"])
	}

	c, w = newContext(uid, "POST", "/heart-rate/import", map[string]any{
		"samples": []map[string]any{heartRateSampleBody("hr-dup", at, 95)},
	})
	th.ImportHeartRateSamples(c)
	data = decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 0 || data["updated"].(float64) != 1 {
		t.Errorf("second import: imported=%v updated=%v, want 0/1", data["imported"], data["updated"])
	}

	c, w = newContext(uid, "GET", "/heart-rate", nil)
	th.ListHeartRateSamples(c)
	samples := decodeResponse(t, w)["data"].([]any)
	if len(samples) != 1 || samples[0].(map[string]any)["bpm"].(float64) != 95 {
		t.Errorf("existing row was not overwritten with resubmitted values: %v", samples)
	}
}

func TestGetHeartRateDailyStats(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	day := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	body := map[string]any{
		"samples": []map[string]any{
			heartRateSampleBody("hr-a", day, 60),
			heartRateSampleBody("hr-b", day.Add(time.Hour), 100),
			heartRateSampleBody("hr-c", day.Add(2*time.Hour), 80),
		},
	}
	c, w := newContext(uid, "POST", "/heart-rate/import", body)
	th.ImportHeartRateSamples(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/heart-rate/daily", nil)
	th.GetHeartRateDailyStats(c)
	stats := decodeResponse(t, w)["data"].([]any)
	if len(stats) != 1 {
		t.Fatalf("expected 1 daily row, got %d", len(stats))
	}
	s := stats[0].(map[string]any)
	if s["min"].(float64) != 60 || s["max"].(float64) != 100 || s["avg"].(float64) != 80 || s["count"].(float64) != 3 {
		t.Errorf("unexpected daily stats: %v", s)
	}
}

func TestImportHeartRateSamples_validation(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	cases := []struct {
		name string
		body map[string]any
		want int
	}{
		{"missing samples", map[string]any{}, http.StatusUnprocessableEntity},
		{"missing external_id", map[string]any{
			"samples": []map[string]any{{"recorded_at": time.Now().Format(time.RFC3339), "bpm": 70}},
		}, http.StatusUnprocessableEntity},
		{"zero bpm", map[string]any{
			"samples": []map[string]any{{
				"external_id": "hr-x", "recorded_at": time.Now().Format(time.RFC3339), "bpm": 0,
			}},
		}, http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, "POST", "/heart-rate/import", tc.body)
			th.ImportHeartRateSamples(c)
			if w.Code != tc.want {
				t.Errorf("expected %d, got %d: %s", tc.want, w.Code, w.Body.String())
			}
		})
	}
}
