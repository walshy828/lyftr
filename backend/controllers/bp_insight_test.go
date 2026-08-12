package controllers

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/vision"
)

// seedBPWeek inserts one morning reading a day for `days` days, ending
// yesterday, at the given systolic (diastolic tracks it loosely).
func seedBPWeek(t *testing.T, uid int64, days, sys int) {
	t.Helper()
	now := time.Now().UTC()
	for i := 1; i <= days; i++ {
		at := now.AddDate(0, 0, -i).Truncate(24 * time.Hour).Add(8 * time.Hour)
		if _, err := db.DB.Exec(
			`INSERT INTO blood_pressure_logs (user_id, systolic, diastolic, context, rested, tz_offset, logged_at)
			 VALUES (?, ?, ?, 'morning', 1, 0, ?)`,
			uid, sys, sys-50, at,
		); err != nil {
			t.Fatalf("seed bp: %v", err)
		}
	}
}

func TestRunBPInsight_succeedsWithoutVisionProvider(t *testing.T) {
	setupTestDB(t) // th is built with a nil provider
	uid := createTestUser(t)
	seedBPWeek(t, uid, 7, 134)

	c, w := newContext(uid, "POST", "/blood-pressure/insight", nil)
	th.RunBPInsight(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with no provider, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)

	// The facts are the point; the narrative is the optional part.
	if data["facts"] == nil {
		t.Fatal("facts must be present even with no provider")
	}
	if data["report"] != nil {
		t.Errorf("report should be null with no provider, got %v", data["report"])
	}
	facts := data["facts"].(map[string]any)
	if facts["category"] != "stage1" {
		t.Errorf("category = %v, want stage1", facts["category"])
	}
}

func TestRunBPInsight_needsEnoughReadings(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// Two readings on a single day: not enough occasions or days to interpret.
	day := time.Now().UTC().AddDate(0, 0, -1).Truncate(24 * time.Hour)
	insertBPLog(t, uid, 130, 84, day.Add(7*time.Hour))
	insertBPLog(t, uid, 128, 82, day.Add(19*time.Hour))

	c, w := newContext(uid, "POST", "/blood-pressure/insight", nil)
	th.RunBPInsight(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 with too little data, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRunBPInsight_storesFactsWhenProviderFails(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	seedBPWeek(t, uid, 7, 145)

	fake := &fakeVisionProvider{bpErr: errProviderDown}
	h := NewHandler(stores.New(db.DB), fake)

	c, w := newContext(uid, "POST", "/blood-pressure/insight", nil)
	h.RunBPInsight(c)

	// A provider failure must not cost the user the numbers we already computed.
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 despite provider error, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["facts"] == nil {
		t.Error("facts should still be stored when the provider fails")
	}
	if data["report"] != nil {
		t.Error("report should be null when the provider fails")
	}
}

func TestRunBPInsight_threadsDeterministicFiguresToProvider(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	allowHealthInsights(t, uid)
	seedBPWeek(t, uid, 10, 145) // stage 2 territory

	// Give the run some contributing-factor context to carry.
	now := time.Now().UTC()
	for i := 1; i <= 3; i++ {
		if _, err := db.DB.Exec(
			`INSERT INTO weight_logs (user_id, weight, logged_at) VALUES (?, ?, ?)`,
			uid, 200-float64(i), now.AddDate(0, 0, -i*10),
		); err != nil {
			t.Fatalf("seed weight: %v", err)
		}
	}
	if _, err := db.DB.Exec(
		`INSERT INTO food_logs (user_id, name, sodium, logged_at) VALUES (?, 'Soup', 3000, ?)`,
		uid, now.AddDate(0, 0, -1).Format("2006-01-02T15:04:05Z"),
	); err != nil {
		t.Fatalf("seed food: %v", err)
	}

	fake := &fakeVisionProvider{bpReport: vision.BPInsightReport{
		Headline:      "Your average is high",
		WhereYouStand: "stand text",
		SeeADoctor:    "Worth discussing with a clinician.",
	}}
	h := NewHandler(stores.New(db.DB), fake)

	c, w := newContext(uid, "POST", "/blood-pressure/insight", nil)
	h.RunBPInsight(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// The model must be handed the app's decisions, not left to derive its own.
	if fake.bpReq.Category != "stage2" {
		t.Errorf("Category = %q, want stage2", fake.bpReq.Category)
	}
	if fake.bpReq.CategoryLabel == "" {
		t.Error("CategoryLabel must be populated — the prompt quotes it verbatim")
	}
	if fake.bpReq.Avg30Sys != 145 {
		t.Errorf("Avg30Sys = %v, want 145", fake.bpReq.Avg30Sys)
	}
	if fake.bpReq.DaysMeasuredLast30 != 10 {
		t.Errorf("DaysMeasuredLast30 = %d, want 10", fake.bpReq.DaysMeasuredLast30)
	}
	if fake.bpReq.AvgSodiumMg != 3000 {
		t.Errorf("AvgSodiumMg = %v, want 3000", fake.bpReq.AvgSodiumMg)
	}
	if fake.bpReq.SodiumTargetMg != 2300 {
		t.Errorf("SodiumTargetMg = %d, want the 2300 default", fake.bpReq.SodiumTargetMg)
	}
	if fake.bpReq.CurrentWeightLbs == 0 {
		t.Error("CurrentWeightLbs should carry the user's latest weight")
	}
	if fake.bpReq.FactsJSON == "" {
		t.Error("FactsJSON must carry the (redacted) facts blob")
	}

	// And the written report must round-trip through storage.
	data := decodeResponse(t, w)["data"].(map[string]any)
	report := data["report"].(map[string]any)
	if report["headline"] != "Your average is high" {
		t.Errorf("headline = %v", report["headline"])
	}
	if report["see_a_doctor"] == "" {
		t.Error("see_a_doctor should survive persistence")
	}
}

func TestGetLatestBPInsight_readsStoredReportAndNeverGenerates(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	allowHealthInsights(t, uid)
	seedBPWeek(t, uid, 7, 128)

	fake := &fakeVisionProvider{bpReport: vision.BPInsightReport{Headline: "original"}}
	h := NewHandler(stores.New(db.DB), fake)

	c, _ := newContext(uid, "POST", "/blood-pressure/insight", nil)
	h.RunBPInsight(c)

	// Change what the provider would say now. A GET must return the STORED
	// text — a report the user read yesterday must not silently change today.
	fake.bpReport = vision.BPInsightReport{Headline: "rewritten"}

	c, w := newContext(uid, "GET", "/blood-pressure/insight", nil)
	h.GetLatestBPInsight(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	if data["report"].(map[string]any)["headline"] != "original" {
		t.Error("GET must return the stored report, not regenerate it")
	}
}

func TestGetLatestBPInsight_404WhenNoneStored(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, "GET", "/blood-pressure/insight", nil)
	th.GetLatestBPInsight(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestBPInsight_prunesHistory(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	seedBPWeek(t, uid, 7, 122)

	for i := 0; i < 15; i++ {
		c, w := newContext(uid, "POST", "/blood-pressure/insight", nil)
		th.RunBPInsight(c)
		if w.Code != http.StatusOK {
			t.Fatalf("run %d: expected 200, got %d", i, w.Code)
		}
	}

	var n int
	if err := db.DB.QueryRow(`SELECT COUNT(*) FROM bp_insights WHERE user_id = ?`, uid).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 12 {
		t.Errorf("history = %d rows, want it pruned to 12", n)
	}
}

func TestGetHealthSummary_includesBothMetrics(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	seedBPWeek(t, uid, 5, 118)
	if _, err := db.DB.Exec(
		`INSERT INTO weight_logs (user_id, weight, logged_at) VALUES (?, ?, ?)`,
		uid, 184.2, time.Now().UTC(),
	); err != nil {
		t.Fatalf("seed weight: %v", err)
	}

	c, w := newContext(uid, "GET", "/health/summary", nil)
	th.GetHealthSummary(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	rows := decodeResponse(t, w)["data"].([]any)

	byKey := map[string]map[string]any{}
	for _, r := range rows {
		m := r.(map[string]any)
		byKey[m["key"].(string)] = m
	}
	if _, ok := byKey["weight"]; !ok {
		t.Error("weight metric missing from health summary")
	}
	bp, ok := byKey["blood_pressure"]
	if !ok {
		t.Fatal("blood_pressure metric missing from health summary")
	}
	// 118/68 averages to normal, so the tone must read as good.
	if bp["value"] != "118/68" {
		t.Errorf("bp value = %v, want 118/68", bp["value"])
	}
	if bp["tone"] != "good" {
		t.Errorf("bp tone = %v, want good", bp["tone"])
	}
	if bp["unit"] != "mmHg" {
		t.Errorf("bp unit = %v", bp["unit"])
	}
}

func TestGetHealthSummary_skipsMetricsWithNoData(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, "GET", "/health/summary", nil)
	th.GetHealthSummary(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if rows := decodeResponse(t, w)["data"].([]any); len(rows) != 0 {
		t.Errorf("expected no metrics for an empty account, got %v", rows)
	}
}

// ─── Health-data export consent ────────────────────────────────────────────
//
// The BP insight prompt carries a full personal health record. Before this it
// went to whichever third-party LLM the operator had configured, with no user
// consent and no redaction, gated only by VISION_PROVIDER — so turning on
// meal-photo scanning silently also started exporting blood pressure history.

// allowHealthInsights opens both gates: the operator flag and the user opt-in.
func allowHealthInsights(t *testing.T, uid int64) {
	t.Helper()
	config.C.AIHealthInsightsEnabled = true
	if _, err := db.DB.Exec(
		`INSERT INTO user_settings (user_id, ai_health_insights_opt_in) VALUES (?, 1)
		 ON CONFLICT(user_id) DO UPDATE SET ai_health_insights_opt_in = 1`, uid,
	); err != nil {
		t.Fatalf("set opt-in: %v", err)
	}
}

func TestBPInsight_noHealthDataLeavesWithoutConsent(t *testing.T) {
	cases := []struct {
		name             string
		operatorFlag     bool
		userOptIn        bool
		wantProviderCall bool
	}{
		{"both gates closed", false, false, false},
		{"operator enabled, user has not opted in", true, false, false},
		{"user opted in, operator has not enabled", false, true, false},
		{"both gates open", true, true, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setupTestDB(t)
			uid := createTestUser(t)
			seedBPWeek(t, uid, 10, 145)

			config.C.AIHealthInsightsEnabled = tc.operatorFlag
			optIn := 0
			if tc.userOptIn {
				optIn = 1
			}
			if _, err := db.DB.Exec(
				`INSERT INTO user_settings (user_id, ai_health_insights_opt_in) VALUES (?, ?)
				 ON CONFLICT(user_id) DO UPDATE SET ai_health_insights_opt_in = ?`, uid, optIn, optIn,
			); err != nil {
				t.Fatalf("seed settings: %v", err)
			}

			fake := &fakeVisionProvider{bpReport: vision.BPInsightReport{Headline: "hi"}}
			h := NewHandler(stores.New(db.DB), fake)

			c, w := newContext(uid, "POST", "/blood-pressure/insight", nil)
			h.RunBPInsight(c)
			// The user's own facts are computed and returned either way — the
			// gate withholds the third-party call, not the feature.
			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}

			called := fake.bpReq.CurrentDate != ""
			if called != tc.wantProviderCall {
				t.Fatalf("provider called = %v, want %v — health data %s",
					called, tc.wantProviderCall,
					map[bool]string{true: "left the machine without consent", false: "was withheld despite consent"}[called])
			}
		})
	}
}

// TestBPInsight_redactsBirthDateFromPrompt: age is what the clinical reasoning
// needs, and it already travels as an integer. An exact date of birth is a
// strong identifier that adds nothing, so it must not appear in the blob pasted
// into the prompt — even though the full record is still stored locally.
func TestBPInsight_redactsBirthDateFromPrompt(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	allowHealthInsights(t, uid)
	seedBPWeek(t, uid, 10, 145)

	if _, err := db.DB.Exec(
		`INSERT INTO user_profile (user_id, birth_date, sex, height_inches) VALUES (?, '1985-03-17', 'male', 70)`, uid,
	); err != nil {
		t.Fatalf("seed profile: %v", err)
	}

	fake := &fakeVisionProvider{bpReport: vision.BPInsightReport{Headline: "hi"}}
	h := NewHandler(stores.New(db.DB), fake)

	c, w := newContext(uid, "POST", "/blood-pressure/insight", nil)
	h.RunBPInsight(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if strings.Contains(fake.bpReq.FactsJSON, "1985-03-17") {
		t.Error("birth date was sent to the provider in FactsJSON")
	}
	if fake.bpReq.Age == 0 {
		t.Error("age should still be derived and sent — redaction must not cost the model context it needs")
	}
	if fake.bpReq.Sex != "male" {
		t.Errorf("Sex = %q, want male (clinically relevant, sent as a plain field)", fake.bpReq.Sex)
	}

	// The full record is still kept locally for the user.
	var stored string
	if err := db.DB.QueryRow(`SELECT facts FROM bp_insights WHERE user_id = ?`, uid).Scan(&stored); err != nil {
		t.Fatalf("read stored facts: %v", err)
	}
	if !strings.Contains(stored, "1985-03-17") {
		t.Error("redaction leaked into local storage — the user's own copy should be complete")
	}
}
