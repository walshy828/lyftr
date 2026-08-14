package controllers

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
)

// seedWorkoutOn inserts a workout at a literal started_at string, with one
// exercise carrying the given sets. Taking started_at as a raw string is the
// point: several tests here exist to pin down how the historical datetime
// formats in that column behave.
func seedWorkoutOn(t *testing.T, uid, exID int64, startedAt string, duration int, sets [][2]float64) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO workouts (user_id, name, duration, started_at) VALUES (?, 'Session', ?, ?)`,
		uid, duration, startedAt,
	)
	if err != nil {
		t.Fatalf("seed workout: %v", err)
	}
	wid, _ := res.LastInsertId()

	res, err = db.DB.Exec(
		`INSERT INTO workout_exercises (workout_id, exercise_id, order_index) VALUES (?, ?, 0)`,
		wid, exID,
	)
	if err != nil {
		t.Fatalf("seed workout exercise: %v", err)
	}
	weid, _ := res.LastInsertId()

	for i, s := range sets {
		if _, err := db.DB.Exec(
			`INSERT INTO sets (workout_exercise_id, set_number, reps, weight, is_warmup, completed)
			 VALUES (?, ?, ?, ?, 0, 1)`,
			weid, i+1, int(s[0]), s[1],
		); err != nil {
			t.Fatalf("seed set: %v", err)
		}
	}
	return wid
}

func namedExercise(t *testing.T, name, muscle string) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO exercises (name, muscle_group, category) VALUES (?, ?, 'strength')`,
		name, muscle,
	)
	if err != nil {
		t.Fatalf("seed exercise %q: %v", name, err)
	}
	id, _ := res.LastInsertId()
	return id
}

func statsRequest(t *testing.T, uid int64, query string) map[string]any {
	t.Helper()
	c, w := newContext(uid, http.MethodGet, "/api/v1/workouts/stats?"+query, nil)
	c.Request.URL.RawQuery = query
	th.GetWorkoutStats(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	return decodeResponse(t, w)["data"].(map[string]any)
}

func TestWorkoutStats_dailyRollup(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Bench Press", "chest")

	// Two workouts on the same day, one on another.
	seedWorkoutOn(t, uid, exID, "2026-03-02T12:00:00Z", 1800, [][2]float64{{10, 100}, {8, 100}})
	seedWorkoutOn(t, uid, exID, "2026-03-02T18:00:00Z", 900, [][2]float64{{5, 200}})
	seedWorkoutOn(t, uid, exID, "2026-03-05T12:00:00Z", 3600, [][2]float64{{10, 50}})

	data := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31&include=daily")
	daily := data["daily"].([]any)
	if len(daily) != 2 {
		t.Fatalf("expected 2 active days, got %d: %v", len(daily), daily)
	}

	d0 := daily[0].(map[string]any)
	if d0["date"] != "2026-03-02" {
		t.Errorf("expected first day 2026-03-02, got %v", d0["date"])
	}
	if d0["workouts"].(float64) != 2 {
		t.Errorf("expected 2 workouts on 03-02, got %v", d0["workouts"])
	}
	// The duration must NOT be multiplied by the set count — the exact failure a
	// flat JOIN onto sets would produce (1800+900 = 2700, not 2700*3).
	if got := d0["duration"].(float64); got != 2700 {
		t.Errorf("expected duration 2700s on 03-02, got %v (a flat set JOIN inflates this)", got)
	}
	// 10*100 + 8*100 + 5*200 = 2800
	if got := d0["volume"].(float64); got != 2800 {
		t.Errorf("expected volume 2800, got %v", got)
	}
	if got := d0["sets"].(float64); got != 3 {
		t.Errorf("expected 3 sets, got %v", got)
	}

	totals := data["totals"].(map[string]any)
	if got := totals["workouts"].(float64); got != 3 {
		t.Errorf("expected 3 total workouts, got %v", got)
	}
	if got := totals["active_days"].(float64); got != 2 {
		t.Errorf("expected 2 active days, got %v", got)
	}
	if got := totals["duration"].(float64); got != 6300 {
		t.Errorf("expected total duration 6300, got %v", got)
	}
}

// Warmup and uncompleted sets are excluded from volume everywhere. If the daily
// and muscle queries ever disagree on this predicate, the dashboard's totals
// stop reconciling with its muscle map for no visible reason.
func TestWorkoutStats_excludesWarmupAndIncomplete(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Squat", "quadriceps")

	res, _ := db.DB.Exec(`INSERT INTO workouts (user_id, name, duration, started_at) VALUES (?, 'S', 60, ?)`,
		uid, "2026-03-02T12:00:00Z")
	wid, _ := res.LastInsertId()
	res, _ = db.DB.Exec(`INSERT INTO workout_exercises (workout_id, exercise_id) VALUES (?, ?)`, wid, exID)
	weid, _ := res.LastInsertId()

	db.DB.Exec(`INSERT INTO sets (workout_exercise_id, set_number, reps, weight, is_warmup, completed) VALUES (?,1,10,100,0,1)`, weid)
	db.DB.Exec(`INSERT INTO sets (workout_exercise_id, set_number, reps, weight, is_warmup, completed) VALUES (?,2,10,999,1,1)`, weid) // warmup
	db.DB.Exec(`INSERT INTO sets (workout_exercise_id, set_number, reps, weight, is_warmup, completed) VALUES (?,3,10,999,0,0)`, weid) // not completed

	data := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31")

	day := data["daily"].([]any)[0].(map[string]any)
	if got := day["volume"].(float64); got != 1000 {
		t.Errorf("daily volume: expected 1000 (working sets only), got %v", got)
	}
	if got := day["sets"].(float64); got != 1 {
		t.Errorf("daily sets: expected 1, got %v", got)
	}

	for _, m := range data["muscles"].([]any) {
		mm := m.(map[string]any)
		if mm["muscle_group"] != "quadriceps" {
			continue
		}
		if got := mm["volume"].(float64); got != 1000 {
			t.Errorf("muscle volume: expected 1000, got %v — must match the daily query's predicate", got)
		}
		if got := mm["sets"].(float64); got != 1 {
			t.Errorf("muscle sets: expected 1, got %v", got)
		}
	}
}

// workouts.started_at holds three historical formats. SQLite's date() returns
// NULL for Go's time.Time.String() layout, so a bare date() would silently drop
// the oldest rows out of every statistic. This pins the COALESCE fallback.
func TestWorkoutStats_toleratesLegacyDateFormats(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Deadlift", "hamstrings")

	formats := []string{
		"2026-03-02T12:00:00Z",                 // RFC3339 (current writes)
		"2026-03-03 12:00:00",                  // SQLite CURRENT_TIMESTAMP
		"2026-03-04 12:00:00.123456 -0000 UTC", // Go time.Time.String() — date() is NULL here
		"2026-03-06 08:00:00.7 +0000 UTC",      // same layout, different precision
	}
	for _, f := range formats {
		seedWorkoutOn(t, uid, exID, f, 600, [][2]float64{{5, 100}})
	}

	data := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31")

	if got := data["totals"].(map[string]any)["workouts"].(float64); got != float64(len(formats)) {
		t.Errorf("expected all %d workouts counted regardless of datetime format, got %v", len(formats), got)
	}
	if got := len(data["daily"].([]any)); got != len(formats) {
		t.Errorf("expected %d distinct active days, got %d — a legacy format was dropped", len(formats), got)
	}
}

// The tz offset must move the day boundary. A workout at 02:00 UTC belongs to
// the previous local day for a user at UTC-5 — get this wrong and every late
// evening session lands on tomorrow's square.
func TestWorkoutStats_tzOffsetShiftsDayBoundary(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Row", "back")

	seedWorkoutOn(t, uid, exID, "2026-03-03T02:30:00Z", 600, [][2]float64{{5, 100}})

	utc := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31&tz_offset=0&include=daily")
	if got := utc["daily"].([]any)[0].(map[string]any)["date"]; got != "2026-03-03" {
		t.Errorf("at UTC expected 2026-03-03, got %v", got)
	}

	est := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31&tz_offset=-300&include=daily")
	if got := est["daily"].([]any)[0].(map[string]any)["date"]; got != "2026-03-02" {
		t.Errorf("at UTC-5 expected 2026-03-02, got %v", got)
	}
}

// Muscles the user never trained must come back with zeros, not be absent.
// "You haven't trained calves in 6 weeks" cannot be derived from a missing key.
func TestWorkoutStats_includesUntrainedMuscles(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	chest := namedExercise(t, "Bench Press", "chest")
	namedExercise(t, "Calf Raise", "calves") // in the library, never trained

	seedWorkoutOn(t, uid, chest, "2026-03-02T12:00:00Z", 600, [][2]float64{{10, 100}})

	data := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31&include=muscles")
	byGroup := map[string]map[string]any{}
	for _, m := range data["muscles"].([]any) {
		mm := m.(map[string]any)
		byGroup[mm["muscle_group"].(string)] = mm
	}

	calves, ok := byGroup["calves"]
	if !ok {
		t.Fatalf("untrained muscle group missing from response: %v", byGroup)
	}
	if got := calves["sets"].(float64); got != 0 {
		t.Errorf("expected 0 sets for calves, got %v", got)
	}
	if got := calves["last_trained"].(string); got != "" {
		t.Errorf("expected empty last_trained for a never-trained muscle, got %q", got)
	}
	if got := byGroup["chest"]["sets"].(float64); got != 1 {
		t.Errorf("expected 1 chest set, got %v", got)
	}
	// Trained muscles sort first.
	if first := data["muscles"].([]any)[0].(map[string]any)["muscle_group"]; first != "chest" {
		t.Errorf("expected the most-trained muscle first, got %v", first)
	}
}

// last_trained deliberately escapes the window: a neglect badge is only useful
// when it can name a date the window doesn't contain.
func TestWorkoutStats_lastTrainedIgnoresWindow(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Bench Press", "chest")

	seedWorkoutOn(t, uid, exID, "2026-01-15T12:00:00Z", 600, [][2]float64{{10, 100}})

	data := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31&include=muscles")
	for _, m := range data["muscles"].([]any) {
		mm := m.(map[string]any)
		if mm["muscle_group"] != "chest" {
			continue
		}
		if got := mm["sets"].(float64); got != 0 {
			t.Errorf("expected 0 sets inside the window, got %v", got)
		}
		if got := mm["last_trained"].(string); got != "2026-01-15" {
			t.Errorf("expected last_trained 2026-01-15 from outside the window, got %q", got)
		}
	}
}

func TestWorkoutStats_streak(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Bench Press", "chest")

	today := time.Now().UTC()
	// A live run ending today (3 days), and an older, longer run (5 days).
	for i := 0; i < 3; i++ {
		day := today.AddDate(0, 0, -i).Format("2006-01-02")
		seedWorkoutOn(t, uid, exID, day+"T12:00:00Z", 600, [][2]float64{{5, 100}})
	}
	for i := 20; i < 25; i++ {
		day := today.AddDate(0, 0, -i).Format("2006-01-02")
		seedWorkoutOn(t, uid, exID, day+"T12:00:00Z", 600, [][2]float64{{5, 100}})
	}

	data := statsRequest(t, uid, "include=streak&tz_offset=0")
	streak := data["streak"].(map[string]any)
	if got := streak["current"].(float64); got != 3 {
		t.Errorf("expected current streak 3, got %v", got)
	}
	if got := streak["longest"].(float64); got != 5 {
		t.Errorf("expected longest streak 5, got %v", got)
	}
}

// A run that ended yesterday is still current — the day isn't over.
func TestWorkoutStats_streakSurvivesToday(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Bench Press", "chest")

	today := time.Now().UTC()
	for i := 1; i <= 2; i++ {
		day := today.AddDate(0, 0, -i).Format("2006-01-02")
		seedWorkoutOn(t, uid, exID, day+"T12:00:00Z", 600, [][2]float64{{5, 100}})
	}

	data := statsRequest(t, uid, "include=streak&tz_offset=0")
	if got := data["streak"].(map[string]any)["current"].(float64); got != 2 {
		t.Errorf("a streak ending yesterday must still be current, got %v", got)
	}
}

// A run that ended two days ago is over.
func TestWorkoutStats_streakBreaks(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Bench Press", "chest")

	today := time.Now().UTC()
	for i := 3; i <= 5; i++ {
		day := today.AddDate(0, 0, -i).Format("2006-01-02")
		seedWorkoutOn(t, uid, exID, day+"T12:00:00Z", 600, [][2]float64{{5, 100}})
	}

	data := statsRequest(t, uid, "include=streak&tz_offset=0")
	streak := data["streak"].(map[string]any)
	if got := streak["current"].(float64); got != 0 {
		t.Errorf("expected a broken streak to be 0, got %v", got)
	}
	if got := streak["longest"].(float64); got != 3 {
		t.Errorf("expected longest 3, got %v", got)
	}
}

func TestWorkoutStats_scopedToUser(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)
	exID := namedExercise(t, "Bench Press", "chest")

	seedWorkoutOn(t, other, exID, "2026-03-02T12:00:00Z", 600, [][2]float64{{10, 500}})

	data := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31")
	if got := data["totals"].(map[string]any)["workouts"].(float64); got != 0 {
		t.Errorf("another user's workouts leaked into stats: %v", got)
	}
	for _, m := range data["muscles"].([]any) {
		mm := m.(map[string]any)
		if got := mm["volume"].(float64); got != 0 {
			t.Errorf("another user's volume leaked into %v: %v", mm["muscle_group"], got)
		}
	}
}

func TestWorkoutStats_include(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	exID := namedExercise(t, "Bench Press", "chest")
	seedWorkoutOn(t, uid, exID, "2026-03-02T12:00:00Z", 600, [][2]float64{{10, 100}})

	only := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31&include=daily")
	if _, ok := only["muscles"]; ok {
		t.Error("muscles present despite include=daily")
	}
	if _, ok := only["streak"]; ok {
		t.Error("streak present despite include=daily")
	}
	// Totals are always present: they're derived from the daily rows for free.
	if only["totals"].(map[string]any)["workouts"].(float64) != 1 {
		t.Error("totals should be computed regardless of include")
	}

	all := statsRequest(t, uid, "from=2026-03-01&to=2026-03-31")
	for _, k := range []string{"daily", "muscles", "streak"} {
		if _, ok := all[k]; !ok {
			t.Errorf("an absent include must default to everything; %q missing", k)
		}
	}
}

func TestWorkoutStats_rejectsBadRange(t *testing.T) {
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
			c, w := newContext(uid, http.MethodGet, "/api/v1/workouts/stats?"+tc.query, nil)
			c.Request.URL.RawQuery = tc.query
			th.GetWorkoutStats(c)
			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestWorkoutStats_emptyHistory(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	data := statsRequest(t, uid, "tz_offset=0")
	totals := data["totals"].(map[string]any)
	if got := totals["workouts"].(float64); got != 0 {
		t.Errorf("expected 0 workouts, got %v", got)
	}
	if got := data["streak"].(map[string]any)["current"].(float64); got != 0 {
		t.Errorf("expected 0 streak, got %v", got)
	}
	if data["weight_unit"] != "lbs" {
		t.Errorf("expected the default weight unit, got %v", data["weight_unit"])
	}
}

// A PR is ranked by estimated 1RM, not raw weight, and the feed is ordered by
// WHEN the record was set — a lifetime best from two years ago is not news and
// must not permanently occupy the top.
func TestRecentPRs(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	bench := namedExercise(t, "Bench Press", "chest")
	squat := namedExercise(t, "Squat", "quadriceps")

	// An old, very heavy bench PR...
	seedWorkoutOn(t, uid, bench, "2026-01-10T12:00:00Z", 600, [][2]float64{{10, 225}}) // e1RM 300
	// ...beaten on weight but not on e1RM by a later single.
	seedWorkoutOn(t, uid, bench, "2026-02-10T12:00:00Z", 600, [][2]float64{{1, 250}}) // e1RM 250
	// A recent squat record.
	seedWorkoutOn(t, uid, squat, "2026-06-01T12:00:00Z", 600, [][2]float64{{5, 315}})

	c, w := newContext(uid, http.MethodGet, "/api/v1/workouts/prs", nil)
	th.GetRecentPRs(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 2 {
		t.Fatalf("expected one PR per exercise, got %d", len(data))
	}

	// Newest record first.
	first := data[0].(map[string]any)
	if first["exercise_name"] != "Squat" {
		t.Errorf("expected the most recent record first, got %v", first["exercise_name"])
	}

	second := data[1].(map[string]any)
	if second["exercise_name"] != "Bench Press" {
		t.Fatalf("expected Bench Press second, got %v", second["exercise_name"])
	}
	// The 10x225 set wins on e1RM despite 250 being the heavier weight.
	if got := second["reps"].(float64); got != 10 {
		t.Errorf("expected the 10-rep set to be the PR, got reps %v", got)
	}
	if got := second["weight"].(float64); got != 225 {
		t.Errorf("expected weight 225, got %v", got)
	}
	if got := second["estimated_1rm"].(float64); got != 300 {
		t.Errorf("expected e1RM 300, got %v", got)
	}
}

func TestRecentPRs_excludesUnweightedAndOtherUsers(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)
	ex := namedExercise(t, "Pull Up", "lats")

	seedWorkoutOn(t, uid, ex, "2026-06-01T12:00:00Z", 600, [][2]float64{{12, 0}}) // bodyweight
	seedWorkoutOn(t, other, ex, "2026-06-02T12:00:00Z", 600, [][2]float64{{5, 100}})

	c, w := newContext(uid, http.MethodGet, "/api/v1/workouts/prs", nil)
	th.GetRecentPRs(c)

	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 0 {
		t.Errorf("expected no PRs (bodyweight has no load, and another user's must not leak): %v", data)
	}
}
