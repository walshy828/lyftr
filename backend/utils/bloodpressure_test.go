package utils

import (
	"math"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// The boundary cases matter more than the interior ones here: every ACC/AHA
// threshold is an inclusive lower bound except the crisis one, and the "or"
// rule (either number qualifies) is the part implementations get wrong.
func TestClassifyBP(t *testing.T) {
	cases := []struct {
		name     string
		sys, dia int
		want     string
	}{
		{"textbook normal", 115, 75, BPCategoryNormal},
		{"top of normal", 119, 79, BPCategoryNormal},

		{"bottom of elevated", 120, 79, BPCategoryElevated},
		{"top of elevated", 129, 79, BPCategoryElevated},

		// The "or" rule: diastolic alone pushes these into stage 1 even though
		// the systolic reads Elevated or Normal on its own.
		{"diastolic 80 forces stage 1", 120, 80, BPCategoryStage1},
		{"normal systolic, diastolic 85", 110, 85, BPCategoryStage1},
		{"bottom of stage 1 by systolic", 130, 79, BPCategoryStage1},
		{"top of stage 1", 139, 89, BPCategoryStage1},

		{"bottom of stage 2 by systolic", 140, 89, BPCategoryStage2},
		{"bottom of stage 2 by diastolic", 139, 90, BPCategoryStage2},
		{"stage 2 upper edge", 180, 120, BPCategoryStage2},
		// Crisis is strictly greater-than, so 180/120 above is still stage 2.
		{"crisis by systolic", 181, 120, BPCategoryCrisis},
		{"crisis by diastolic", 180, 121, BPCategoryCrisis},

		{"low by systolic", 88, 70, BPCategoryLow},
		{"low by diastolic", 95, 55, BPCategoryLow},
		// A low systolic must not mask a high diastolic — this pair is
		// hypertensive, not "low", and reading it as low would hide a problem.
		{"low systolic with high diastolic is stage 2", 85, 95, BPCategoryStage2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyBP(tc.sys, tc.dia); got != tc.want {
				t.Errorf("ClassifyBP(%d, %d) = %q, want %q", tc.sys, tc.dia, got, tc.want)
			}
		})
	}
}

func TestBPCategoryRank_ordersHypertensionLadder(t *testing.T) {
	ladder := []string{
		BPCategoryNormal, BPCategoryElevated, BPCategoryStage1,
		BPCategoryStage2, BPCategoryCrisis,
	}
	for i := 1; i < len(ladder); i++ {
		if BPCategoryRank(ladder[i]) <= BPCategoryRank(ladder[i-1]) {
			t.Errorf("rank(%s) should exceed rank(%s)", ladder[i], ladder[i-1])
		}
	}
}

// "Low" is an advisory aside, not a rung on the ladder: a single low reading
// must never outrank a genuine stage 2 when picking the worst of a window.
func TestBPCategoryRank_lowDoesNotOutrankHypertension(t *testing.T) {
	if BPCategoryRank(BPCategoryLow) >= BPCategoryRank(BPCategoryElevated) {
		t.Error("low should rank below elevated")
	}
	if got := WorseBPCategory(BPCategoryLow, BPCategoryStage2); got != BPCategoryStage2 {
		t.Errorf("WorseBPCategory(low, stage2) = %q, want stage2", got)
	}
}

func TestWorseBPCategory(t *testing.T) {
	if got := WorseBPCategory(BPCategoryNormal, BPCategoryStage1); got != BPCategoryStage1 {
		t.Errorf("got %q, want stage1", got)
	}
	if got := WorseBPCategory(BPCategoryCrisis, BPCategoryStage1); got != BPCategoryCrisis {
		t.Errorf("got %q, want crisis", got)
	}
	if got := WorseBPCategory(BPCategoryNormal, BPCategoryNormal); got != BPCategoryNormal {
		t.Errorf("got %q, want normal", got)
	}
}

// --- Sessions, days, windows -------------------------------------------------

func bpLog(sys, dia int, at time.Time, tz int) models.BloodPressureLog {
	return models.BloodPressureLog{Systolic: sys, Diastolic: dia, LoggedAt: at.UTC(), TZOffset: tz}
}

func TestGroupBPSessions_collapsesReadingsTakenTogether(t *testing.T) {
	base := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{
		bpLog(130, 84, base, 0),
		bpLog(126, 80, base.Add(time.Minute), 0), // same occasion
	}
	got := GroupBPSessions(logs)
	if len(got) != 1 {
		t.Fatalf("readings a minute apart should be one session, got %d", len(got))
	}
	if got[0].Count != 2 {
		t.Errorf("Count = %d, want 2", got[0].Count)
	}
	if got[0].Systolic != 128 || got[0].Diastolic != 82 {
		t.Errorf("session mean = %.0f/%.0f, want 128/82", got[0].Systolic, got[0].Diastolic)
	}
}

func TestGroupBPSessions_splitsSeparateOccasions(t *testing.T) {
	base := time.Date(2026, 8, 10, 7, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{
		bpLog(130, 84, base, 0),
		bpLog(126, 80, base.Add(20*time.Minute), 0), // beyond the 15 min gap
	}
	if got := GroupBPSessions(logs); len(got) != 2 {
		t.Fatalf("readings 20 min apart should be two sessions, got %d", len(got))
	}
}

// The grouper must not assume its input is sorted — List returns newest first.
func TestGroupBPSessions_handlesUnorderedInput(t *testing.T) {
	base := time.Date(2026, 8, 10, 7, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{
		bpLog(140, 90, base.Add(2*time.Hour), 0),
		bpLog(120, 78, base, 0),
		bpLog(122, 80, base.Add(time.Minute), 0),
	}
	got := GroupBPSessions(logs)
	if len(got) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(got))
	}
	if !got[0].At.Before(got[1].At) {
		t.Error("sessions should come out chronological")
	}
	if got[0].Count != 2 {
		t.Errorf("the two close readings should group: Count = %d", got[0].Count)
	}
}

// The whole reason tz_offset is stored: 02:00 UTC in New York is 22:00 the
// PREVIOUS local day, and it's an evening reading, not a morning one.
func TestGroupBPDays_usesLocalDayFromTZOffset(t *testing.T) {
	at := time.Date(2026, 8, 11, 2, 0, 0, 0, time.UTC)
	sessions := GroupBPSessions([]models.BloodPressureLog{bpLog(120, 78, at, -300)})
	days := GroupBPDays(sessions)

	if len(days) != 1 {
		t.Fatalf("expected 1 day, got %d", len(days))
	}
	if days[0].Day != "2026-08-10" {
		t.Errorf("local day = %q, want 2026-08-10", days[0].Day)
	}
	if days[0].Morning {
		t.Error("22:00 local is not a morning reading")
	}
	if !days[0].Evening {
		t.Error("22:00 local should count as an evening reading")
	}
}

// The core weighting rule: a day measured six times must not outvote five days
// measured once.
func TestSummarizeBPWindow_weightsDaysEqually(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{}
	// One day, six high readings, each its own occasion.
	for i := 0; i < 6; i++ {
		at := now.AddDate(0, 0, -6).Add(time.Duration(i) * time.Hour)
		logs = append(logs, bpLog(170, 100, at, 0))
	}
	// Five separate days, one normal reading each.
	for i := 1; i <= 5; i++ {
		logs = append(logs, bpLog(110, 70, now.AddDate(0, 0, -i), 0))
	}

	sessions := GroupBPSessions(logs)
	days := GroupBPDays(sessions)
	w := SummarizeBPWindow(days, sessions, 7, now)

	if w.DaysWithData != 6 {
		t.Fatalf("DaysWithData = %d, want 6", w.DaysWithData)
	}
	// Mean of daily means: (170 + 110*5) / 6 = 120. Averaging raw readings
	// instead would give (170*6 + 110*5)/11 ≈ 143 — a whole category worse.
	if math.Abs(w.AvgSystolic-120) > 0.5 {
		t.Errorf("AvgSystolic = %.1f, want ~120 (days weighted equally)", w.AvgSystolic)
	}
	// The peak still has to survive the averaging.
	if w.MaxSystolic != 170 {
		t.Errorf("MaxSystolic = %d, want 170", w.MaxSystolic)
	}
	if w.WorstCategory != BPCategoryStage2 {
		t.Errorf("WorstCategory = %q, want stage2", w.WorstCategory)
	}
}

func TestSummarizeBPWindow_emptyWindowIsNotAFalseNormal(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	w := SummarizeBPWindow(nil, nil, 7, now)
	if w.DaysWithData != 0 {
		t.Fatalf("DaysWithData = %d, want 0", w.DaysWithData)
	}
	// No data must not read as "normal" — that would be a reassuring lie.
	if w.Category != "" || w.WorstCategory != "" {
		t.Errorf("empty window should have no category, got %q/%q", w.Category, w.WorstCategory)
	}
}

// --- Trend -------------------------------------------------------------------

func TestBPTrend_fitsFallingSeries(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	since := now.AddDate(0, 0, -30)
	logs := []models.BloodPressureLog{}
	// 140 down to 110 over 30 days: -30 mmHg per 30 days.
	for i := 0; i <= 30; i++ {
		logs = append(logs, bpLog(140-i, 90, since.AddDate(0, 0, i), 0))
	}
	days := GroupBPDays(GroupBPSessions(logs))

	sys, _, n, ok := BPTrend(days, since, now)
	if !ok {
		t.Fatalf("expected a fit, got ok=false (n=%d)", n)
	}
	if math.Abs(sys-(-30)) > 1 {
		t.Errorf("sysPer30d = %.1f, want ~-30", sys)
	}
	if ClassifyBPTrend(sys, 0) != BPTrendImproving {
		t.Error("a 30 mmHg fall should classify as improving")
	}
}

func TestBPTrend_needsThreeDays(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	since := now.AddDate(0, 0, -30)
	days := GroupBPDays(GroupBPSessions([]models.BloodPressureLog{
		bpLog(130, 84, since, 0),
		bpLog(128, 82, since.AddDate(0, 0, 1), 0),
	}))
	if _, _, _, ok := BPTrend(days, since, now); ok {
		t.Error("two days is not enough to fit a trend")
	}
}

func TestClassifyBPTrend_noiseBand(t *testing.T) {
	cases := []struct {
		name     string
		sys, dia float64
		want     string
	}{
		{"inside the noise band is stable", -2.5, 1, BPTrendStable},
		{"at the boundary counts", -3.0, 0, BPTrendImproving},
		{"clear rise", 6, 2, BPTrendWorsening},
		// Diastolic only overrides when systolic itself says nothing.
		{"diastolic-led improvement", -1, -5, BPTrendImproving},
		{"flat", 0, 0, BPTrendStable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyBPTrend(tc.sys, tc.dia); got != tc.want {
				t.Errorf("ClassifyBPTrend(%.1f, %.1f) = %q, want %q", tc.sys, tc.dia, got, tc.want)
			}
		})
	}
}

// --- Capture protocol --------------------------------------------------------

func nudgeKeys(ns []BPNudge) []string {
	out := make([]string, len(ns))
	for i, n := range ns {
		out[i] = n.Key
	}
	return out
}

func hasNudge(ns []BPNudge, key string) bool {
	for _, n := range ns {
		if n.Key == key {
			return true
		}
	}
	return false
}

func TestEvaluateBPProtocol_noReadings(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	got := EvaluateBPProtocol(nil, nil, now)
	if len(got) != 1 || got[0].Key != BPNudgeNoReadings {
		t.Fatalf("want a single no_readings nudge, got %v", nudgeKeys(got))
	}
}

// Crisis has to come first no matter what else is wrong with the data.
func TestEvaluateBPProtocol_crisisOutranksEverything(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{
		bpLog(190, 125, now.AddDate(0, 0, -1), 0),
	}
	sessions := GroupBPSessions(logs)
	got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now)

	if len(got) == 0 || got[0].Key != BPNudgeCrisisReading {
		t.Fatalf("crisis must rank first, got %v", nudgeKeys(got))
	}
	if got[0].Severity != BPSeverityUrgent {
		t.Errorf("crisis severity = %q, want urgent", got[0].Severity)
	}
}

func TestEvaluateBPProtocol_crisisExpiresAfterAWeek(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{bpLog(190, 125, now.AddDate(0, 0, -20), 0)}
	sessions := GroupBPSessions(logs)
	got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now)
	if hasNudge(got, BPNudgeCrisisReading) {
		t.Errorf("a 20-day-old crisis reading should not still be flagged: %v", nudgeKeys(got))
	}
}

func TestEvaluateBPProtocol_stale(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{bpLog(120, 78, now.AddDate(0, 0, -14), 0)}
	sessions := GroupBPSessions(logs)
	if got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now); !hasNudge(got, BPNudgeStale) {
		t.Errorf("want stale, got %v", nudgeKeys(got))
	}
}

func TestEvaluateBPProtocol_sparseWeek(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{
		bpLog(120, 78, now.AddDate(0, 0, -1).Add(8*time.Hour), 0),
		bpLog(122, 79, now.AddDate(0, 0, -2).Add(8*time.Hour), 0),
	}
	sessions := GroupBPSessions(logs)
	if got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now); !hasNudge(got, BPNudgeSparseWeek) {
		t.Errorf("2 of 7 days should trigger sparse_week, got %v", nudgeKeys(got))
	}
}

func TestEvaluateBPProtocol_singleReadingsAndMissingMorning(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{}
	// Seven consecutive days, one evening reading each.
	for i := 1; i <= 7; i++ {
		at := now.AddDate(0, 0, -i).Truncate(24 * time.Hour).Add(19 * time.Hour)
		logs = append(logs, bpLog(120, 78, at, 0))
	}
	sessions := GroupBPSessions(logs)
	got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now)

	if !hasNudge(got, BPNudgeSingleReadings) {
		t.Errorf("one reading per day should trigger single_readings, got %v", nudgeKeys(got))
	}
	if !hasNudge(got, BPNudgeNoMorning) {
		t.Errorf("evening-only should trigger no_morning, got %v", nudgeKeys(got))
	}
	// no_evening is the else-branch of no_morning; both firing would be
	// contradictory advice.
	if hasNudge(got, BPNudgeNoEvening) {
		t.Errorf("no_morning and no_evening must not both fire: %v", nudgeKeys(got))
	}
	if hasNudge(got, BPNudgeSparseWeek) {
		t.Errorf("7 of 7 days is not sparse: %v", nudgeKeys(got))
	}
}

func TestEvaluateBPProtocol_postWorkoutHeavy(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{}
	for i := 1; i <= 6; i++ {
		at := now.AddDate(0, 0, -i).Truncate(24 * time.Hour).Add(8 * time.Hour)
		r := bpLog(130, 84, at, 0)
		if i%2 == 0 {
			r.Context = models.BPContextPostWorkout
		}
		logs = append(logs, r)
	}
	sessions := GroupBPSessions(logs)
	if got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now); !hasNudge(got, BPNudgePostWorkoutHeavy) {
		t.Errorf("half the sessions post-workout should trigger it, got %v", nudgeKeys(got))
	}
}

func TestEvaluateBPProtocol_unrested(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{}
	for i := 1; i <= 6; i++ {
		at := now.AddDate(0, 0, -i).Truncate(24 * time.Hour).Add(8 * time.Hour)
		logs = append(logs, bpLog(122, 79, at, 0)) // Rested defaults false
	}
	sessions := GroupBPSessions(logs)
	if got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now); !hasNudge(got, BPNudgeUnrested) {
		t.Errorf("want unrested, got %v", nudgeKeys(got))
	}
}

func TestEvaluateBPProtocol_highVariability(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	swings := []int{100, 160, 105, 155, 110, 150, 108}
	logs := []models.BloodPressureLog{}
	for i, sys := range swings {
		at := now.AddDate(0, 0, -(i + 1)).Truncate(24 * time.Hour).Add(8 * time.Hour)
		r := bpLog(sys, 80, at, 0)
		r.Rested = true
		logs = append(logs, r)
	}
	sessions := GroupBPSessions(logs)
	if got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now); !hasNudge(got, BPNudgeHighVariability) {
		t.Errorf("a 50 mmHg swing should trigger high_variability, got %v", nudgeKeys(got))
	}
}

// A user measuring exactly the way the guidance says should be told nothing
// about their protocol — otherwise the nudges are noise.
func TestEvaluateBPProtocol_goodProtocolProducesNoNudges(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	logs := []models.BloodPressureLog{}
	for i := 1; i <= 7; i++ {
		day := now.AddDate(0, 0, -i).Truncate(24 * time.Hour)
		for _, spec := range []struct {
			hour int
			ctx  string
		}{{7, models.BPContextMorning}, {19, models.BPContextEvening}} {
			for k := 0; k < 2; k++ { // two readings a minute apart
				r := bpLog(118+k, 76, day.Add(time.Duration(spec.hour)*time.Hour+time.Duration(k)*time.Minute), 0)
				r.Context = spec.ctx
				r.Rested = true
				logs = append(logs, r)
			}
		}
	}
	sessions := GroupBPSessions(logs)
	if got := EvaluateBPProtocol(GroupBPDays(sessions), sessions, now); len(got) != 0 {
		t.Errorf("textbook protocol should produce no nudges, got %v", nudgeKeys(got))
	}
}
