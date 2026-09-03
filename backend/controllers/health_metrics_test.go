package controllers

import (
	"net/http"
	"testing"
	"time"
)

func healthMetricBody(metricType, externalID string, at time.Time, value float64) map[string]any {
	return map[string]any{
		"metric_type": metricType,
		"external_id": externalID,
		"recorded_at": at.Format(time.RFC3339),
		"value":       value,
	}
}

func TestImportHealthMetrics_createsAndReturnsMetrics(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	at := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/health-metrics/import", map[string]any{
		"metrics": []map[string]any{
			healthMetricBody("hrv_rmssd", "hm-1", at, 45.2),
			healthMetricBody("spo2", "hm-2", at, 98.0),
		},
	})
	th.ImportHealthMetrics(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 2 {
		t.Errorf("imported = %v, want 2", data["imported"])
	}

	c, w = newContext(uid, "GET", "/health-metrics", nil)
	th.ListHealthMetrics(c)
	metrics := decodeResponse(t, w)["data"].([]any)
	if len(metrics) != 2 {
		t.Fatalf("expected 2 metrics, got %d", len(metrics))
	}
}

func TestListHealthMetrics_filtersByType(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	at := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/health-metrics/import", map[string]any{
		"metrics": []map[string]any{
			healthMetricBody("hrv_rmssd", "hm-a", at, 45.2),
			healthMetricBody("spo2", "hm-b", at, 98.0),
		},
	})
	th.ImportHealthMetrics(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/health-metrics?metric_type=spo2", nil)
	th.ListHealthMetrics(c)
	metrics := decodeResponse(t, w)["data"].([]any)
	if len(metrics) != 1 || metrics[0].(map[string]any)["metric_type"] != "spo2" {
		t.Errorf("expected only spo2 metric, got %v", metrics)
	}
}

// Mirrors cardio's resubmit-safe upsert test.
func TestImportHealthMetrics_upsertsOnResubmit(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	at := time.Date(2026, 3, 4, 7, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/health-metrics/import", map[string]any{
		"metrics": []map[string]any{healthMetricBody("vo2_max", "hm-dup", at, 40.0)},
	})
	th.ImportHealthMetrics(c)
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 1 || data["updated"].(float64) != 0 {
		t.Errorf("first import: imported=%v updated=%v, want 1/0", data["imported"], data["updated"])
	}

	c, w = newContext(uid, "POST", "/health-metrics/import", map[string]any{
		"metrics": []map[string]any{healthMetricBody("vo2_max", "hm-dup", at, 41.5)},
	})
	th.ImportHealthMetrics(c)
	data = decodeResponse(t, w)["data"].(map[string]any)
	if data["imported"].(float64) != 0 || data["updated"].(float64) != 1 {
		t.Errorf("second import: imported=%v updated=%v, want 0/1", data["imported"], data["updated"])
	}

	c, w = newContext(uid, "GET", "/health-metrics", nil)
	th.ListHealthMetrics(c)
	metrics := decodeResponse(t, w)["data"].([]any)
	if len(metrics) != 1 || metrics[0].(map[string]any)["value"].(float64) != 41.5 {
		t.Errorf("existing row was not overwritten with resubmitted value: %v", metrics)
	}
}

func TestGetHealthMetricsDaily_sumsStepsByDefault(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	day := time.Date(2026, 3, 4, 8, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/health-metrics/import", map[string]any{
		"metrics": []map[string]any{
			healthMetricBody("steps", "steps-1", day, 3000),
			healthMetricBody("steps", "steps-2", day.Add(4*time.Hour), 4500),
		},
	})
	th.ImportHealthMetrics(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, "GET", "/health-metrics/daily?metric_type=steps&from=2026-03-01&to=2026-03-10&tz_offset=0", nil)
	th.GetHealthMetricsDaily(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	stats := decodeResponse(t, w)["data"].([]any)
	if len(stats) != 1 {
		t.Fatalf("expected 1 daily row, got %d", len(stats))
	}
	s := stats[0].(map[string]any)
	if s["value"].(float64) != 7500 {
		t.Errorf("value = %v, want 7500 (sum, default agg for steps)", s["value"])
	}
	if s["count"].(float64) != 2 {
		t.Errorf("count = %v, want 2", s["count"])
	}
}

func TestGetHealthMetricsDaily_averagesByDefaultForOtherMetrics(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	day := time.Date(2026, 3, 4, 8, 0, 0, 0, time.UTC)
	c, w := newContext(uid, "POST", "/health-metrics/import", map[string]any{
		"metrics": []map[string]any{
			healthMetricBody("hrv_rmssd", "hrv-1", day, 40.0),
			healthMetricBody("hrv_rmssd", "hrv-2", day.Add(4*time.Hour), 60.0),
		},
	})
	th.ImportHealthMetrics(c)

	c, w = newContext(uid, "GET", "/health-metrics/daily?metric_type=hrv_rmssd&from=2026-03-01&to=2026-03-10&tz_offset=0", nil)
	th.GetHealthMetricsDaily(c)
	stats := decodeResponse(t, w)["data"].([]any)
	if len(stats) != 1 || stats[0].(map[string]any)["value"].(float64) != 50 {
		t.Errorf("expected averaged value 50, got %v", stats)
	}
}

func TestGetHealthMetricsDaily_requiresKnownMetricType(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, "GET", "/health-metrics/daily", nil)
	th.GetHealthMetricsDaily(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing metric_type, got %d", w.Code)
	}

	c, w = newContext(uid, "GET", "/health-metrics/daily?metric_type=not_a_real_metric", nil)
	th.GetHealthMetricsDaily(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for unknown metric_type, got %d", w.Code)
	}
}

func TestGetHealthMetricsDaily_rejectsInvalidAgg(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, "GET", "/health-metrics/daily?metric_type=steps&agg=median", nil)
	th.GetHealthMetricsDaily(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid agg, got %d: %s", w.Code, w.Body.String())
	}
}

func TestImportHealthMetrics_validation(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	cases := []struct {
		name string
		body map[string]any
		want int
	}{
		{"missing metrics", map[string]any{}, http.StatusUnprocessableEntity},
		{"missing metric_type", map[string]any{
			"metrics": []map[string]any{{
				"external_id": "hm-x", "recorded_at": time.Now().Format(time.RFC3339), "value": 1.0,
			}},
		}, http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, "POST", "/health-metrics/import", tc.body)
			th.ImportHealthMetrics(c)
			if w.Code != tc.want {
				t.Errorf("expected %d, got %d: %s", tc.want, w.Code, w.Body.String())
			}
		})
	}
}
