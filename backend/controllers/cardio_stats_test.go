package controllers

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
)

// seedCardioOn inserts a cardio session at a literal started_at string,
// mirroring seedWorkoutOn — several tests here exist to pin down how
// cardio_sessions.started_at behaves under the same historical-format
// concerns as workouts.started_at.
func seedCardioOn(t *testing.T, uid int64, externalID, startedAt string, durationSeconds int, distanceMeters, calories float64) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO cardio_sessions
		 (user_id, external_id, activity_type, started_at, ended_at, duration_seconds, distance_meters, avg_heart_rate, calories, source)
		 VALUES (?, ?, 'running', ?, ?, ?, ?, 0, ?, 'health_connect')`,
		uid, externalID, startedAt, startedAt, durationSeconds, distanceMeters, calories,
	)
	if err != nil {
		t.Fatalf("seed cardio session: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func cardioStatsRequest(t *testing.T, uid int64, query string) map[string]any {
	t.Helper()
	c, w := newContext(uid, http.MethodGet, "/api/v1/cardio/stats?"+query, nil)
	c.Request.URL.RawQuery = query
	th.GetCardioStats(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	return decodeResponse(t, w)["data"].(map[string]any)
}

func TestCardioStats_dailyRollup(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	seedCardioOn(t, uid, "hc-1", "2026-03-02T07:00:00Z", 1800, 5000, 320)
	seedCardioOn(t, uid, "hc-2", "2026-03-02T18:00:00Z", 900, 2500, 160)
	seedCardioOn(t, uid, "hc-3", "2026-03-05T07:00:00Z", 3600, 10000, 640)

	data := cardioStatsRequest(t, uid, "from=2026-03-01&to=2026-03-31&include=daily")
	daily := data["daily"].([]any)
	if len(daily) != 2 {
		t.Fatalf("expected 2 active days, got %d: %v", len(daily), daily)
	}

	d0 := daily[0].(map[string]any)
	if d0["date"] != "2026-03-02" {
		t.Errorf("expected first day 2026-03-02, got %v", d0["date"])
	}
	if got := d0["sessions"].(float64); got != 2 {
		t.Errorf("expected 2 sessions on 03-02, got %v", got)
	}
	if got := d0["duration"].(float64); got != 2700 {
		t.Errorf("expected duration 2700s on 03-02, got %v", got)
	}
	if got := d0["distance_meters"].(float64); got != 7500 {
		t.Errorf("expected distance 7500m on 03-02, got %v", got)
	}

	totals := data["totals"].(map[string]any)
	if got := totals["sessions"].(float64); got != 3 {
		t.Errorf("expected 3 total sessions, got %v", got)
	}
	if got := totals["active_days"].(float64); got != 2 {
		t.Errorf("expected 2 active days, got %v", got)
	}
	if got := totals["calories"].(float64); got != 1120 {
		t.Errorf("expected total calories 1120, got %v", got)
	}
}

// cardio_sessions.started_at is bound as a raw Go time.Time on insert (see
// CardioStore.Import), which the sqlite driver serializes via
// time.Time.String() — SQLite's date() returns NULL on that layout. This pins
// the COALESCE fallback in cardioDayExpr, same concern as the workouts table.
func TestCardioStats_toleratesLegacyDateFormats(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	formats := []string{
		"2026-03-02T12:00:00Z",                 // RFC3339
		"2026-03-03 12:00:00",                  // SQLite CURRENT_TIMESTAMP-shaped
		"2026-03-04 12:00:00.123456 -0000 UTC", // Go time.Time.String() — date() is NULL here
	}
	for i, f := range formats {
		seedCardioOn(t, uid, fmt.Sprintf("hc-fmt-%d", i), f, 600, 1000, 80)
	}

	data := cardioStatsRequest(t, uid, "from=2026-03-01&to=2026-03-31")

	if got := data["totals"].(map[string]any)["sessions"].(float64); got != float64(len(formats)) {
		t.Errorf("expected all %d sessions counted regardless of datetime format, got %v", len(formats), got)
	}
}

func TestCardioStats_tzOffsetShiftsDayBoundary(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	seedCardioOn(t, uid, "hc-tz", "2026-03-03T02:30:00Z", 600, 1000, 80)

	utc := cardioStatsRequest(t, uid, "from=2026-03-01&to=2026-03-31&tz_offset=0&include=daily")
	if got := utc["daily"].([]any)[0].(map[string]any)["date"]; got != "2026-03-03" {
		t.Errorf("at UTC expected 2026-03-03, got %v", got)
	}

	est := cardioStatsRequest(t, uid, "from=2026-03-01&to=2026-03-31&tz_offset=-300&include=daily")
	if got := est["daily"].([]any)[0].(map[string]any)["date"]; got != "2026-03-02" {
		t.Errorf("at UTC-5 expected 2026-03-02, got %v", got)
	}
}

func TestCardioStats_streak(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	today := time.Now().UTC()
	for i := 0; i < 3; i++ {
		day := today.AddDate(0, 0, -i).Format("2006-01-02")
		seedCardioOn(t, uid, "hc-cur-"+day, day+"T12:00:00Z", 600, 1000, 80)
	}
	for i := 20; i < 25; i++ {
		day := today.AddDate(0, 0, -i).Format("2006-01-02")
		seedCardioOn(t, uid, "hc-old-"+day, day+"T12:00:00Z", 600, 1000, 80)
	}

	data := cardioStatsRequest(t, uid, "include=streak&tz_offset=0")
	streak := data["streak"].(map[string]any)
	if got := streak["current"].(float64); got != 3 {
		t.Errorf("expected current streak 3, got %v", got)
	}
	if got := streak["longest"].(float64); got != 5 {
		t.Errorf("expected longest streak 5, got %v", got)
	}
}

func TestCardioStats_streakSurvivesToday(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	today := time.Now().UTC()
	for i := 1; i <= 2; i++ {
		day := today.AddDate(0, 0, -i).Format("2006-01-02")
		seedCardioOn(t, uid, "hc-"+day, day+"T12:00:00Z", 600, 1000, 80)
	}

	data := cardioStatsRequest(t, uid, "include=streak&tz_offset=0")
	if got := data["streak"].(map[string]any)["current"].(float64); got != 2 {
		t.Errorf("a streak ending yesterday must still be current, got %v", got)
	}
}

func TestCardioStats_scopedToUser(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)

	seedCardioOn(t, other, "hc-other", "2026-03-02T12:00:00Z", 600, 1000, 80)

	data := cardioStatsRequest(t, uid, "from=2026-03-01&to=2026-03-31")
	if got := data["totals"].(map[string]any)["sessions"].(float64); got != 0 {
		t.Errorf("another user's cardio sessions leaked into stats: %v", got)
	}
}

func TestCardioStats_include(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	seedCardioOn(t, uid, "hc-1", "2026-03-02T12:00:00Z", 600, 1000, 80)

	only := cardioStatsRequest(t, uid, "from=2026-03-01&to=2026-03-31&include=daily")
	if _, ok := only["streak"]; ok {
		t.Error("streak present despite include=daily")
	}
	if only["totals"].(map[string]any)["sessions"].(float64) != 1 {
		t.Error("totals should be computed regardless of include")
	}

	all := cardioStatsRequest(t, uid, "from=2026-03-01&to=2026-03-31")
	for _, k := range []string{"daily", "streak"} {
		if _, ok := all[k]; !ok {
			t.Errorf("an absent include must default to everything; %q missing", k)
		}
	}
}

func TestCardioStats_rejectsBadRange(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	cases := []struct{ name, query string }{
		{"unparseable from", "from=nonsense&to=2026-03-31"},
		{"unparseable to", "from=2026-03-01&to=nonsense"},
		{"inverted range", "from=2026-03-31&to=2026-03-01"},
		{"span too long", fmt.Sprintf("from=2020-01-01&to=%s", time.Now().Format("2006-01-02"))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, http.MethodGet, "/api/v1/cardio/stats?"+tc.query, nil)
			c.Request.URL.RawQuery = tc.query
			th.GetCardioStats(c)
			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestCardioStats_emptyHistory(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	data := cardioStatsRequest(t, uid, "tz_offset=0")
	totals := data["totals"].(map[string]any)
	if got := totals["sessions"].(float64); got != 0 {
		t.Errorf("expected 0 sessions, got %v", got)
	}
	if got := data["streak"].(map[string]any)["current"].(float64); got != 0 {
		t.Errorf("expected 0 streak, got %v", got)
	}
	if _, ok := data["combined_streak"]; ok {
		t.Error("combined_streak should be absent unless requested")
	}
}

// The key behavior CombinedStreakFor exists for: a workout on one day and a
// cardio-only session on the very next day must chain into a single 2-day
// combined streak. max(workoutStreak.current, cardioStreak.current) would
// report 1 here, since neither domain alone has a 2-day run.
func TestCardioStats_combinedStreak_unionsWorkoutAndCardioDays(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Bench Press", "chest")

	today := time.Now().UTC()
	yesterday := today.AddDate(0, 0, -1).Format("2006-01-02")
	todayStr := today.Format("2006-01-02")

	// Workout yesterday only, cardio today only — no single-domain streak
	// exceeds 1 day, but together they chain into 2.
	seedWorkoutOn(t, uid, exID, yesterday+"T09:00:00Z", 1800, [][2]float64{{5, 100}})
	seedCardioOn(t, uid, "hc-today", todayStr+"T18:00:00Z", 1800, 5000, 300)

	data := cardioStatsRequest(t, uid, "include=streak&tz_offset=0&combined_streak=1")

	if got := data["streak"].(map[string]any)["current"].(float64); got != 1 {
		t.Errorf("cardio-only streak should be 1 (today only), got %v", got)
	}

	combined, ok := data["combined_streak"].(map[string]any)
	if !ok {
		t.Fatalf("expected combined_streak in response when requested: %v", data)
	}
	if got := combined["current"].(float64); got != 2 {
		t.Errorf("expected combined streak 2 (workout yesterday + cardio today), got %v", got)
	}
}

func TestCardioStats_combinedStreak_absentUnlessRequested(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	seedCardioOn(t, uid, "hc-1", "2026-03-02T12:00:00Z", 600, 1000, 80)

	data := cardioStatsRequest(t, uid, "include=streak")
	if _, ok := data["combined_streak"]; ok {
		t.Error("combined_streak must be opt-in via ?combined_streak=1")
	}
}
