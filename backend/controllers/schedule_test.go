package controllers

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
)

func makeProgram(t *testing.T, uid int64, name string) int64 {
	t.Helper()
	res, err := db.DB.Exec(`INSERT INTO programs (user_id, name) VALUES (?, ?)`, uid, name)
	if err != nil {
		t.Fatalf("create program %q: %v", name, err)
	}
	id, _ := res.LastInsertId()
	return id
}

func putSchedule(t *testing.T, uid int64, days map[string][]int64) {
	t.Helper()
	c, w := newContext(uid, http.MethodPut, "/api/v1/schedule", map[string]any{"days": days})
	th.ReplaceSchedule(c)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT /schedule: expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func getSchedule(t *testing.T, uid int64, from, to string) []any {
	t.Helper()
	q := fmt.Sprintf("from=%s&to=%s&tz_offset=0", from, to)
	c, w := newContext(uid, http.MethodGet, "/api/v1/schedule?"+q, nil)
	c.Request.URL.RawQuery = q
	th.GetSchedule(c)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /schedule: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	return decodeResponse(t, w)["data"].(map[string]any)["days"].([]any)
}

func dayNamed(t *testing.T, days []any, date string) map[string]any {
	t.Helper()
	for _, d := range days {
		dd := d.(map[string]any)
		if dd["date"] == date {
			return dd
		}
	}
	t.Fatalf("date %s missing from schedule response", date)
	return nil
}

func programNames(day map[string]any) []string {
	out := []string{}
	for _, p := range day["programs"].([]any) {
		out = append(out, p.(map[string]any)["name"].(string))
	}
	return out
}

// 2026-08-17 is a Monday; the dates below are that week.
const (
	mon     = "2026-08-17"
	tue     = "2026-08-18"
	nextMon = "2026-08-24"
)

func TestSchedule_recurringRepeatsWeekly(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	push := makeProgram(t, uid, "Push")

	putSchedule(t, uid, map[string][]int64{"1": {push}}) // Monday

	days := getSchedule(t, uid, mon, nextMon)
	if got := programNames(dayNamed(t, days, mon)); len(got) != 1 || got[0] != "Push" {
		t.Errorf("expected Push on Monday, got %v", got)
	}
	if got := programNames(dayNamed(t, days, nextMon)); len(got) != 1 || got[0] != "Push" {
		t.Errorf("expected Push to recur next Monday, got %v", got)
	}
	if src := dayNamed(t, days, tue)["source"]; src != "rest" {
		t.Errorf("expected Tuesday to be a rest day, got %v", src)
	}
}

// A program can sit on several weekdays, and a weekday can carry several
// programs — the two cases a weekday column on `programs` could not express.
func TestSchedule_multipleProgramsAndDays(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	push := makeProgram(t, uid, "Push")
	mobility := makeProgram(t, uid, "Mobility")

	putSchedule(t, uid, map[string][]int64{
		"1": {push, mobility}, // two on Monday
		"4": {push},           // same program again on Thursday
	})

	days := getSchedule(t, uid, mon, "2026-08-23")
	if got := programNames(dayNamed(t, days, mon)); len(got) != 2 {
		t.Errorf("expected 2 programs on Monday, got %v", got)
	}
	if got := programNames(dayNamed(t, days, "2026-08-20")); len(got) != 1 || got[0] != "Push" {
		t.Errorf("expected Push on Thursday too, got %v", got)
	}
}

// The whole point of the overrides table: moving one week's session must not
// disturb the pattern.
func TestSchedule_overrideMovesOneDayOnly(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	legs := makeProgram(t, uid, "Legs")

	putSchedule(t, uid, map[string][]int64{"1": {legs}}) // every Monday

	// Rest this Monday...
	c, w := newContext(uid, http.MethodPost, "/api/v1/schedule/overrides",
		map[string]any{"date": mon, "program_ids": []int64{}})
	th.SetScheduleOverride(c)
	if w.Code != http.StatusOK {
		t.Fatalf("set rest override: %d: %s", w.Code, w.Body.String())
	}
	// ...and do legs on Tuesday instead.
	c, w = newContext(uid, http.MethodPost, "/api/v1/schedule/overrides",
		map[string]any{"date": tue, "program_ids": []int64{legs}})
	th.SetScheduleOverride(c)
	if w.Code != http.StatusOK {
		t.Fatalf("set tuesday override: %d: %s", w.Code, w.Body.String())
	}

	days := getSchedule(t, uid, mon, nextMon)

	if src := dayNamed(t, days, mon)["source"]; src != "rest" {
		t.Errorf("expected this Monday to be an explicit rest day, got %v", src)
	}
	if got := len(dayNamed(t, days, mon)["programs"].([]any)); got != 0 {
		t.Errorf("expected no programs this Monday, got %d", got)
	}
	if got := programNames(dayNamed(t, days, tue)); len(got) != 1 || got[0] != "Legs" {
		t.Errorf("expected Legs moved to Tuesday, got %v", got)
	}
	if src := dayNamed(t, days, tue)["source"]; src != "override" {
		t.Errorf("expected Tuesday to be marked as an override, got %v", src)
	}
	// The pattern itself is untouched.
	if got := programNames(dayNamed(t, days, nextMon)); len(got) != 1 || got[0] != "Legs" {
		t.Errorf("next Monday must still be leg day, got %v", got)
	}
}

// "Explicit rest" and "no override" are different states and must resolve
// differently — a NULL row is what makes the first one representable.
func TestSchedule_clearOverrideRevertsToPattern(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	legs := makeProgram(t, uid, "Legs")
	putSchedule(t, uid, map[string][]int64{"1": {legs}})

	c, _ := newContext(uid, http.MethodPost, "/api/v1/schedule/overrides",
		map[string]any{"date": mon, "program_ids": []int64{}})
	th.SetScheduleOverride(c)

	if got := programNames(dayNamed(t, getSchedule(t, uid, mon, mon), mon)); len(got) != 0 {
		t.Fatalf("expected the override to clear the day, got %v", got)
	}

	c, w := newContext(uid, http.MethodDelete, "/api/v1/schedule/overrides/"+mon, nil)
	setParam(c, "date", mon)
	th.ClearScheduleOverride(c)
	if w.Code != http.StatusOK {
		t.Fatalf("clear override: %d: %s", w.Code, w.Body.String())
	}

	day := dayNamed(t, getSchedule(t, uid, mon, mon), mon)
	if got := programNames(day); len(got) != 1 || got[0] != "Legs" {
		t.Errorf("expected the pattern back after clearing, got %v", got)
	}
	if day["source"] != "recurring" {
		t.Errorf("expected source 'recurring', got %v", day["source"])
	}
}

// A logged workout marks its scheduled slot done, so the UI doesn't prompt a
// duplicate session.
func TestSchedule_marksCompleted(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	push := makeProgram(t, uid, "Push")
	putSchedule(t, uid, map[string][]int64{"1": {push}})

	res, err := db.DB.Exec(
		`INSERT INTO workouts (user_id, name, program_id, started_at) VALUES (?, 'Push', ?, ?)`,
		uid, push, mon+"T18:00:00Z",
	)
	if err != nil {
		t.Fatal(err)
	}
	wid, _ := res.LastInsertId()

	day := dayNamed(t, getSchedule(t, uid, mon, mon), mon)
	p := day["programs"].([]any)[0].(map[string]any)
	if p["completed_workout_id"] == nil {
		t.Fatalf("expected the slot to be marked done: %v", p)
	}
	if int64(p["completed_workout_id"].(float64)) != wid {
		t.Errorf("expected workout id %d, got %v", wid, p["completed_workout_id"])
	}

	// A different Monday must NOT inherit the completion.
	next := dayNamed(t, getSchedule(t, uid, mon, nextMon), nextMon)
	if next["programs"].([]any)[0].(map[string]any)["completed_workout_id"] != nil {
		t.Error("completion leaked onto another occurrence of the same weekday")
	}
}

func TestSchedule_today(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	push := makeProgram(t, uid, "Push")

	today := time.Now().UTC()
	putSchedule(t, uid, map[string][]int64{fmt.Sprint(int(today.Weekday())): {push}})

	c, w := newContext(uid, http.MethodGet, "/api/v1/schedule/today?tz_offset=0", nil)
	c.Request.URL.RawQuery = "tz_offset=0"
	th.GetTodaysWorkout(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	day := decodeResponse(t, w)["data"].(map[string]any)
	if got := programNames(day); len(got) != 1 || got[0] != "Push" {
		t.Errorf("expected today's program, got %v", got)
	}
}

// Scheduling someone else's program must fail. Otherwise a user could pin a
// program they can't see, and the owner deleting it would mutate their calendar.
func TestSchedule_rejectsOtherUsersProgram(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)
	theirs := makeProgram(t, other, "Theirs")

	c, w := newContext(uid, http.MethodPut, "/api/v1/schedule",
		map[string]any{"days": map[string][]int64{"1": {theirs}}})
	th.ReplaceSchedule(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}

	if len(getSchedule(t, uid, mon, mon)[0].(map[string]any)["programs"].([]any)) != 0 {
		t.Error("a rejected request still wrote a schedule row")
	}
}

// Deleting a program unschedules it, via ON DELETE CASCADE rather than app code.
func TestSchedule_deletingProgramUnschedules(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	push := makeProgram(t, uid, "Push")
	putSchedule(t, uid, map[string][]int64{"1": {push}})

	if _, err := db.DB.Exec(`DELETE FROM programs WHERE id = ?`, push); err != nil {
		t.Fatalf("delete program: %v", err)
	}

	day := dayNamed(t, getSchedule(t, uid, mon, mon), mon)
	if got := len(day["programs"].([]any)); got != 0 {
		t.Errorf("expected the deleted program to be unscheduled, got %d", got)
	}
}

func TestSchedule_replaceIsIdempotentAndFull(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	push := makeProgram(t, uid, "Push")
	pull := makeProgram(t, uid, "Pull")

	putSchedule(t, uid, map[string][]int64{"1": {push}})
	putSchedule(t, uid, map[string][]int64{"1": {push}}) // same again
	if got := programNames(dayNamed(t, getSchedule(t, uid, mon, mon), mon)); len(got) != 1 {
		t.Errorf("re-applying the same schedule duplicated rows: %v", got)
	}

	// A full replace drops what it omits.
	putSchedule(t, uid, map[string][]int64{"2": {pull}})
	if got := programNames(dayNamed(t, getSchedule(t, uid, mon, tue), mon)); len(got) != 0 {
		t.Errorf("Monday should have been cleared by the replace, got %v", got)
	}
	if got := programNames(dayNamed(t, getSchedule(t, uid, mon, tue), tue)); len(got) != 1 || got[0] != "Pull" {
		t.Errorf("expected Pull on Tuesday, got %v", got)
	}
}

func TestSchedule_rejectsBadInput(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	push := makeProgram(t, uid, "Push")

	cases := []struct {
		name string
		body map[string]any
	}{
		{"weekday out of range", map[string]any{"days": map[string][]int64{"7": {push}}}},
		{"negative weekday", map[string]any{"days": map[string][]int64{"-1": {push}}}},
		{"non-numeric weekday", map[string]any{"days": map[string][]int64{"monday": {push}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, http.MethodPut, "/api/v1/schedule", tc.body)
			th.ReplaceSchedule(c)
			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}

	c, w := newContext(uid, http.MethodPost, "/api/v1/schedule/overrides",
		map[string]any{"date": "not-a-date", "program_ids": []int64{}})
	th.SetScheduleOverride(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for a bad override date, got %d", w.Code)
	}

	q := "from=2026-01-01&to=2026-12-31"
	c, w = newContext(uid, http.MethodGet, "/api/v1/schedule?"+q, nil)
	c.Request.URL.RawQuery = q
	th.GetSchedule(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for an over-long range, got %d", w.Code)
	}
}

func TestSchedule_scopedToUser(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := otherUser(t)
	theirs := makeProgram(t, other, "Theirs")

	// Seed the other user's schedule directly, bypassing the ownership check.
	db.DB.Exec(`INSERT INTO program_schedules (user_id, program_id, weekday) VALUES (?, ?, 1)`, other, theirs)

	if got := programNames(dayNamed(t, getSchedule(t, uid, mon, mon), mon)); len(got) != 0 {
		t.Errorf("another user's schedule leaked: %v", got)
	}
}
