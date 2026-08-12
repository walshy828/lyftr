package controllers

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/models"
)

func insertBPLog(t *testing.T, uid int64, sys, dia int, loggedAt time.Time) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO blood_pressure_logs (user_id, systolic, diastolic, logged_at) VALUES (?, ?, ?, ?)`,
		uid, sys, dia, loggedAt.UTC(),
	)
	if err != nil {
		t.Fatalf("insert bp log: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func bpBody(sys, dia int) map[string]any {
	return map[string]any{"systolic": sys, "diastolic": dia}
}

func TestLogBloodPressure_createsReadingWithCategory(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, "POST", "/blood-pressure", map[string]any{
		"systolic": 134, "diastolic": 86, "pulse": 62,
		"context": models.BPContextMorning, "arm": "left",
		"position": "seated", "rested": true, "tz_offset": -300,
	})
	th.LogBloodPressure(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["systolic"].(float64) != 134 || data["diastolic"].(float64) != 86 {
		t.Errorf("reading did not round-trip: %v", data)
	}
	// 134/86 is stage 1 on systolic; the server must stamp it so clients never
	// re-implement the thresholds.
	if data["category"] != "stage1" {
		t.Errorf("category = %v, want stage1", data["category"])
	}
	if data["rested"] != true || data["context"] != "morning" || data["tz_offset"].(float64) != -300 {
		t.Errorf("context fields did not round-trip: %v", data)
	}
}

// The defining difference from weight_logs: BP has no per-day upsert, because
// AHA guidance is several readings a day.
func TestLogBloodPressure_keepsMultipleReadingsPerDay(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	day := time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC)
	for _, r := range [][2]int{{128, 82}, {124, 78}, {131, 84}} {
		c, w := newContext(uid, "POST", "/blood-pressure", map[string]any{
			"systolic": r[0], "diastolic": r[1],
			"logged_at": day.Add(7 * time.Hour).Format(time.RFC3339),
		})
		th.LogBloodPressure(c)
		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
		}
	}

	c, w := newContext(uid, "GET", "/blood-pressure", nil)
	th.ListBloodPressureLogs(c)
	logs := decodeResponse(t, w)["data"].([]any)
	if len(logs) != 3 {
		t.Fatalf("expected all 3 same-day readings to persist, got %d", len(logs))
	}
}

func TestLogBloodPressure_validation(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	cases := []struct {
		name string
		body map[string]any
		want int
	}{
		// Cross-field rule the validate tags can't express.
		{"systolic below diastolic", bpBody(80, 120), http.StatusBadRequest},
		{"systolic equals diastolic", bpBody(100, 100), http.StatusBadRequest},
		{"systolic absurdly high", bpBody(400, 90), http.StatusUnprocessableEntity},
		{"missing systolic", map[string]any{"diastolic": 80}, http.StatusUnprocessableEntity},
		{"bad context enum", map[string]any{
			"systolic": 120, "diastolic": 80, "context": "whenever",
		}, http.StatusUnprocessableEntity},
		{"bad arm enum", map[string]any{
			"systolic": 120, "diastolic": 80, "arm": "third",
		}, http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, "POST", "/blood-pressure", tc.body)
			th.LogBloodPressure(c)
			if w.Code != tc.want {
				t.Errorf("expected %d, got %d: %s", tc.want, w.Code, w.Body.String())
			}
		})
	}
}

func TestListBloodPressureLogs_scopedToUserAndOrdered(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "bp-other@x.com", "x")
	otherID, _ := other.LastInsertId()

	now := time.Now().UTC()
	insertBPLog(t, uid, 120, 78, now.Add(-48*time.Hour))
	insertBPLog(t, uid, 132, 85, now.Add(-1*time.Hour))
	insertBPLog(t, otherID, 190, 130, now)

	c, w := newContext(uid, "GET", "/blood-pressure", nil)
	th.ListBloodPressureLogs(c)

	logs := decodeResponse(t, w)["data"].([]any)
	if len(logs) != 2 {
		t.Fatalf("expected 2 own readings, got %d", len(logs))
	}
	// Newest first.
	if logs[0].(map[string]any)["systolic"].(float64) != 132 {
		t.Error("expected newest reading first")
	}
	if logs[0].(map[string]any)["category"] != "stage1" {
		t.Errorf("list must stamp category, got %v", logs[0].(map[string]any)["category"])
	}
}

func TestListBloodPressureLogs_dateRange(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	insertBPLog(t, uid, 120, 78, time.Date(2026, 3, 1, 8, 0, 0, 0, time.UTC))
	insertBPLog(t, uid, 130, 84, time.Date(2026, 3, 10, 8, 0, 0, 0, time.UTC))
	insertBPLog(t, uid, 140, 92, time.Date(2026, 3, 20, 8, 0, 0, 0, time.UTC))

	c, w := newContext(uid, "GET", "/blood-pressure?from=2026-03-05&to=2026-03-15", nil)
	th.ListBloodPressureLogs(c)

	logs := decodeResponse(t, w)["data"].([]any)
	if len(logs) != 1 {
		t.Fatalf("expected 1 reading in range, got %d", len(logs))
	}
	if logs[0].(map[string]any)["systolic"].(float64) != 130 {
		t.Errorf("wrong reading returned: %v", logs[0])
	}
}

func TestGetBloodPressureLog_ownershipEnforced(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "bp-thief@x.com", "x")
	otherID, _ := other.LastInsertId()

	id := insertBPLog(t, uid, 122, 80, time.Now().UTC())

	// Another user's read must 404, not 403 — a 403 would confirm the row exists.
	c, w := newContext(otherID, "GET", "/blood-pressure/1", nil)
	setParam(c, "id", fmt.Sprint(id))
	th.GetBloodPressureLog(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for another user's reading, got %d", w.Code)
	}

	c, w = newContext(uid, "GET", "/blood-pressure/1", nil)
	setParam(c, "id", fmt.Sprint(id))
	th.GetBloodPressureLog(c)
	if w.Code != http.StatusOK {
		t.Errorf("owner should get 200, got %d", w.Code)
	}
}

func TestUpdateBloodPressureLog(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "bp-other2@x.com", "x")
	otherID, _ := other.LastInsertId()

	id := insertBPLog(t, uid, 145, 95, time.Now().UTC())

	c, w := newContext(uid, "PATCH", "/blood-pressure/1", map[string]any{
		"systolic": 118, "diastolic": 76,
	})
	setParam(c, "id", fmt.Sprint(id))
	th.UpdateBloodPressureLog(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["systolic"].(float64) != 118 || data["category"] != "normal" {
		t.Errorf("update did not apply or recategorize: %v", data)
	}

	c, w = newContext(otherID, "PATCH", "/blood-pressure/1", bpBody(120, 80))
	setParam(c, "id", fmt.Sprint(id))
	th.UpdateBloodPressureLog(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 updating another user's reading, got %d", w.Code)
	}
}

func TestDeleteBloodPressureLog(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "bp-other3@x.com", "x")
	otherID, _ := other.LastInsertId()

	id := insertBPLog(t, uid, 122, 80, time.Now().UTC())

	c, w := newContext(otherID, "DELETE", "/blood-pressure/1", nil)
	setParam(c, "id", fmt.Sprint(id))
	th.DeleteBloodPressureLog(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 deleting another user's reading, got %d", w.Code)
	}

	c, w = newContext(uid, "DELETE", "/blood-pressure/1", nil)
	setParam(c, "id", fmt.Sprint(id))
	th.DeleteBloodPressureLog(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	c, w = newContext(uid, "DELETE", "/blood-pressure/1", nil)
	setParam(c, "id", fmt.Sprint(id))
	th.DeleteBloodPressureLog(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("second delete should 404, got %d", w.Code)
	}
}

func TestDeleteUser_cascadesBloodPressureLogs(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	insertBPLog(t, uid, 122, 80, time.Now().UTC())

	if _, err := db.DB.Exec(`DELETE FROM users WHERE id = ?`, uid); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	var n int
	if err := db.DB.QueryRow(`SELECT COUNT(*) FROM blood_pressure_logs WHERE user_id = ?`, uid).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("expected BP logs to cascade-delete, %d remain", n)
	}
}

func TestGetBloodPressureStats_emptyHistoryIsNotAFalseNormal(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, "GET", "/blood-pressure/stats", nil)
	th.GetBloodPressureStats(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with no data, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)

	if data["latest"] != nil {
		t.Errorf("latest should be null with no readings, got %v", data["latest"])
	}
	if data["total_readings"].(float64) != 0 {
		t.Errorf("total_readings = %v, want 0", data["total_readings"])
	}
	for _, wnd := range data["windows"].([]any) {
		m := wnd.(map[string]any)
		if m["days_with_data"].(float64) != 0 {
			t.Errorf("window %v should have no data", m["days"])
		}
		// An empty window must not claim "normal" — that reads as reassurance
		// the app hasn't earned.
		if m["category"] != "" {
			t.Errorf("empty window category = %v, want empty", m["category"])
		}
	}
	nudges := data["nudges"].([]any)
	if len(nudges) != 1 || nudges[0].(map[string]any)["key"] != "no_readings" {
		t.Errorf("want a single no_readings nudge, got %v", nudges)
	}
}

func TestGetBloodPressureStats_windowsAndTrend(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// 40 days of a clear downward trend, one morning reading a day.
	now := time.Now().UTC()
	for i := 40; i >= 1; i-- {
		at := now.AddDate(0, 0, -i).Truncate(24 * time.Hour).Add(8 * time.Hour)
		if _, err := db.DB.Exec(
			`INSERT INTO blood_pressure_logs (user_id, systolic, diastolic, context, rested, tz_offset, logged_at)
			 VALUES (?, ?, ?, 'morning', 1, 0, ?)`,
			uid, 100+i, 70+i/3, at,
		); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	c, w := newContext(uid, "GET", "/blood-pressure/stats", nil)
	th.GetBloodPressureStats(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)

	windows := data["windows"].([]any)
	if len(windows) != 3 {
		t.Fatalf("expected 7/30/90 windows, got %d", len(windows))
	}
	w7 := windows[0].(map[string]any)
	w30 := windows[1].(map[string]any)
	if w7["days"].(float64) != 7 || w30["days"].(float64) != 30 {
		t.Errorf("windows out of order: %v", windows)
	}
	// Values fall over time, so the recent 7-day average must sit below the
	// 30-day one.
	if w7["avg_systolic"].(float64) >= w30["avg_systolic"].(float64) {
		t.Errorf("7d avg (%v) should be below 30d avg (%v) on a falling series",
			w7["avg_systolic"], w30["avg_systolic"])
	}

	trend := data["trend"].(map[string]any)
	if trend["label"] != "improving" {
		t.Errorf("trend label = %v, want improving", trend["label"])
	}
	if trend["sys_per_30d"].(float64) >= 0 {
		t.Errorf("sys_per_30d = %v, want negative", trend["sys_per_30d"])
	}

	if len(data["daily"].([]any)) != 40 {
		t.Errorf("daily series = %d points, want 40", len(data["daily"].([]any)))
	}
	if data["total_readings"].(float64) != 40 {
		t.Errorf("total_readings = %v, want 40", data["total_readings"])
	}
}

func TestGetBloodPressureStats_isScopedToUser(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "bp-stats@x.com", "x")
	otherID, _ := other.LastInsertId()

	insertBPLog(t, otherID, 190, 130, time.Now().UTC())

	c, w := newContext(uid, "GET", "/blood-pressure/stats", nil)
	th.GetBloodPressureStats(c)
	data := decodeResponse(t, w)["data"].(map[string]any)

	if data["total_readings"].(float64) != 0 {
		t.Errorf("another user's readings leaked into stats: %v", data["total_readings"])
	}
}
