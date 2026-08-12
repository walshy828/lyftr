package utils

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// Blood pressure classification (#bloodPressure).
//
// Everything in this file is pure and deterministic. That is deliberate: the
// categories, the trend, and the capture-protocol nudges must all be identical
// on a server with no AI provider configured. The AI layer interprets what
// these functions decide — it never decides it.

// ACC/AHA 2017 categories, plus "low" which is not part of that guideline and
// is advisory only.
const (
	BPCategoryLow      = "low"
	BPCategoryNormal   = "normal"
	BPCategoryElevated = "elevated"
	BPCategoryStage1   = "stage1"
	BPCategoryStage2   = "stage2"
	BPCategoryCrisis   = "crisis"
)

// ClassifyBP maps one systolic/diastolic pair to its ACC/AHA 2017 category.
//
// Note the "or" rule: a reading qualifies for a stage if EITHER number does, so
// 120/80 is Stage 1 rather than Elevated, and 118/92 is Stage 2 despite a
// perfectly normal systolic. Implementations that test both numbers together
// systematically under-report, which is the single most common way this gets
// written wrong.
//
// Ordering matters — the checks run worst-first so the highest qualifying
// category wins.
func ClassifyBP(sys, dia int) string {
	switch {
	case sys > 180 || dia > 120:
		return BPCategoryCrisis
	case sys >= 140 || dia >= 90:
		return BPCategoryStage2
	case sys >= 130 || dia >= 80:
		return BPCategoryStage1
	case sys >= 120:
		// dia < 80 is guaranteed by the Stage 1 arm above.
		return BPCategoryElevated
	case sys < 90 || dia < 60:
		return BPCategoryLow
	default:
		return BPCategoryNormal
	}
}

// BPCategoryRank orders categories for "worst reading in this window"
// comparisons.
//
// "low" ranks alongside normal rather than above Stage 1: it's a separate
// advisory axis, not a rung on the hypertension ladder. Ranking it higher would
// let a single 88/58 outrank a genuine Stage 2 week, which is exactly backwards.
func BPCategoryRank(cat string) int {
	switch cat {
	case BPCategoryCrisis:
		return 5
	case BPCategoryStage2:
		return 4
	case BPCategoryStage1:
		return 3
	case BPCategoryElevated:
		return 2
	case BPCategoryNormal, BPCategoryLow:
		return 1
	default:
		return 0
	}
}

// WorseBPCategory returns whichever of the two categories ranks higher.
func WorseBPCategory(a, b string) string {
	if BPCategoryRank(b) > BPCategoryRank(a) {
		return b
	}
	return a
}

// BPCategoryLabel is the human-readable name, used in AI prompt interpolation
// so the model is handed the same wording the user sees.
func BPCategoryLabel(cat string) string {
	switch cat {
	case BPCategoryLow:
		return "Low"
	case BPCategoryNormal:
		return "Normal"
	case BPCategoryElevated:
		return "Elevated"
	case BPCategoryStage1:
		return "Stage 1 hypertension range"
	case BPCategoryStage2:
		return "Stage 2 hypertension range"
	case BPCategoryCrisis:
		return "Hypertensive crisis range"
	default:
		return "Unknown"
	}
}

// --- Sessions, days, and windows -------------------------------------------

// bpSessionGapMinutes is the span within which consecutive readings count as
// one measurement occasion. AHA guidance is to take two or three readings a
// minute apart and average them; treating those as separate data points would
// double-weight exactly the people following the protocol correctly.
const bpSessionGapMinutes = 15

// BPSession is one measurement occasion — the average of the readings taken
// together. Categories are assigned to sessions, never to individual readings
// within a session.
type BPSession struct {
	At        time.Time `json:"at"`
	Systolic  float64   `json:"systolic"`
	Diastolic float64   `json:"diastolic"`
	Pulse     float64   `json:"pulse,omitempty"`
	Count     int       `json:"count"`
	Context   string    `json:"context,omitempty"`
	Rested    bool      `json:"rested"`
	// LocalDay is the calendar day in the user's own timezone, derived from
	// the tz_offset captured with the reading.
	LocalDay string `json:"local_day"`
	// LocalHour is the hour of day (0-23) locally, which is what makes
	// "morning reading" answerable.
	LocalHour int    `json:"local_hour"`
	Category  string `json:"category"`
}

// localTime shifts a stored UTC instant into the wall-clock time the user saw.
func localTime(t time.Time, tzOffsetMinutes int) time.Time {
	return t.UTC().Add(time.Duration(tzOffsetMinutes) * time.Minute)
}

// GroupBPSessions collapses readings into measurement occasions. Input may be
// in any order; output is chronological.
func GroupBPSessions(logs []models.BloodPressureLog) []BPSession {
	if len(logs) == 0 {
		return []BPSession{}
	}
	ordered := make([]models.BloodPressureLog, len(logs))
	copy(ordered, logs)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].LoggedAt.Before(ordered[j].LoggedAt) })

	sessions := []BPSession{}
	var group []models.BloodPressureLog

	flush := func() {
		if len(group) == 0 {
			return
		}
		var sumSys, sumDia, sumPulse float64
		pulseN := 0
		rested := false
		context := ""
		for _, r := range group {
			sumSys += float64(r.Systolic)
			sumDia += float64(r.Diastolic)
			if r.Pulse > 0 {
				sumPulse += float64(r.Pulse)
				pulseN++
			}
			// Any reading in the occasion claiming a proper rest is enough —
			// the rest applies to the sitting, not to each cuff inflation.
			if r.Rested {
				rested = true
			}
			if context == "" && r.Context != "" {
				context = r.Context
			}
		}
		n := float64(len(group))
		first := group[0]
		lt := localTime(first.LoggedAt, first.TZOffset)
		s := BPSession{
			At:        first.LoggedAt.UTC(),
			Systolic:  sumSys / n,
			Diastolic: sumDia / n,
			Count:     len(group),
			Context:   context,
			Rested:    rested,
			LocalDay:  lt.Format("2006-01-02"),
			LocalHour: lt.Hour(),
		}
		if pulseN > 0 {
			s.Pulse = sumPulse / float64(pulseN)
		}
		// Classify from the rounded session mean, which is the number the user
		// is shown — so the label can never disagree with the figure beside it.
		s.Category = ClassifyBP(int(math.Round(s.Systolic)), int(math.Round(s.Diastolic)))
		sessions = append(sessions, s)
		group = nil
	}

	for _, r := range ordered {
		if len(group) > 0 {
			gap := r.LoggedAt.Sub(group[len(group)-1].LoggedAt)
			if gap > bpSessionGapMinutes*time.Minute {
				flush()
			}
		}
		group = append(group, r)
	}
	flush()
	return sessions
}

// Local-hour bounds for the two measurement windows AHA recommends. Morning is
// the more diagnostically useful one (before medication, before caffeine),
// which is why the protocol evaluator flags its absence specifically.
const (
	bpMorningStartHour = 4
	bpMorningEndHour   = 12
	bpEveningStartHour = 17
)

// BPDay is one local calendar day, averaged across its sessions.
type BPDay struct {
	Day       string  `json:"day"`
	Systolic  float64 `json:"systolic"`
	Diastolic float64 `json:"diastolic"`
	Pulse     float64 `json:"pulse,omitempty"`
	Sessions  int     `json:"sessions"`
	Readings  int     `json:"readings"`
	Category  string  `json:"category"`
	Morning   bool    `json:"morning"`
	Evening   bool    `json:"evening"`
	// At is midnight of this local day expressed as a UTC instant, for windowing.
	At time.Time `json:"-"`
}

// GroupBPDays averages sessions into local calendar days, oldest first.
func GroupBPDays(sessions []BPSession) []BPDay {
	if len(sessions) == 0 {
		return []BPDay{}
	}
	order := []string{}
	acc := map[string]*BPDay{}
	sums := map[string][3]float64{} // sys, dia, pulse
	pulseN := map[string]int{}

	for _, s := range sessions {
		d, ok := acc[s.LocalDay]
		if !ok {
			day, _ := time.Parse("2006-01-02", s.LocalDay)
			d = &BPDay{Day: s.LocalDay, At: day}
			acc[s.LocalDay] = d
			order = append(order, s.LocalDay)
		}
		d.Sessions++
		d.Readings += s.Count
		if s.LocalHour >= bpMorningStartHour && s.LocalHour < bpMorningEndHour {
			d.Morning = true
		}
		if s.LocalHour >= bpEveningStartHour {
			d.Evening = true
		}
		cur := sums[s.LocalDay]
		cur[0] += s.Systolic
		cur[1] += s.Diastolic
		if s.Pulse > 0 {
			cur[2] += s.Pulse
			pulseN[s.LocalDay]++
		}
		sums[s.LocalDay] = cur
	}

	sort.Strings(order)
	days := make([]BPDay, 0, len(order))
	for _, k := range order {
		d := acc[k]
		n := float64(d.Sessions)
		d.Systolic = sums[k][0] / n
		d.Diastolic = sums[k][1] / n
		if pulseN[k] > 0 {
			d.Pulse = sums[k][2] / float64(pulseN[k])
		}
		d.Category = ClassifyBP(int(math.Round(d.Systolic)), int(math.Round(d.Diastolic)))
		days = append(days, *d)
	}
	return days
}

// BPWindow is the summary over a rolling window of days.
type BPWindow struct {
	Days          int     `json:"days"`
	AvgSystolic   float64 `json:"avg_systolic"`
	AvgDiastolic  float64 `json:"avg_diastolic"`
	AvgPulse      float64 `json:"avg_pulse,omitempty"`
	Category      string  `json:"category"`
	Readings      int     `json:"readings"`
	Sessions      int     `json:"sessions"`
	DaysWithData  int     `json:"days_with_data"`
	MaxSystolic   int     `json:"max_systolic"`
	MaxDiastolic  int     `json:"max_diastolic"`
	WorstCategory string  `json:"worst_category"`
	// SysStdDev across daily means. Variability is its own signal: a stable
	// 135 and a 115-155 swing average the same but mean different things.
	SysStdDev float64 `json:"sys_std_dev"`
}

// SummarizeBPWindow averages DAILY means rather than raw readings, so every day
// carries equal weight. Averaging readings directly would let one anxious day
// of six measurements outvote a week of single calm ones.
func SummarizeBPWindow(days []BPDay, sessions []BPSession, window int, now time.Time) BPWindow {
	w := BPWindow{Days: window, Category: BPCategoryNormal, WorstCategory: BPCategoryNormal}
	cutoff := now.UTC().AddDate(0, 0, -(window - 1)).Truncate(24 * time.Hour)

	var sumSys, sumDia, sumPulse float64
	pulseDays := 0
	sysVals := []float64{}

	for _, d := range days {
		if d.At.Before(cutoff) {
			continue
		}
		w.DaysWithData++
		w.Readings += d.Readings
		w.Sessions += d.Sessions
		sumSys += d.Systolic
		sumDia += d.Diastolic
		sysVals = append(sysVals, d.Systolic)
		if d.Pulse > 0 {
			sumPulse += d.Pulse
			pulseDays++
		}
	}
	// Peaks and the worst category come from individual SESSIONS, not daily
	// means — a single alarming occasion shouldn't be averaged out of view.
	for _, s := range sessions {
		if s.At.Before(cutoff) {
			continue
		}
		if int(math.Round(s.Systolic)) > w.MaxSystolic {
			w.MaxSystolic = int(math.Round(s.Systolic))
		}
		if int(math.Round(s.Diastolic)) > w.MaxDiastolic {
			w.MaxDiastolic = int(math.Round(s.Diastolic))
		}
		w.WorstCategory = WorseBPCategory(w.WorstCategory, s.Category)
	}

	if w.DaysWithData == 0 {
		w.Category = ""
		w.WorstCategory = ""
		return w
	}
	n := float64(w.DaysWithData)
	w.AvgSystolic = sumSys / n
	w.AvgDiastolic = sumDia / n
	if pulseDays > 0 {
		w.AvgPulse = sumPulse / float64(pulseDays)
	}
	w.Category = ClassifyBP(int(math.Round(w.AvgSystolic)), int(math.Round(w.AvgDiastolic)))
	w.SysStdDev = stdDev(sysVals)
	return w
}

func stdDev(vals []float64) float64 {
	if len(vals) < 2 {
		return 0
	}
	var mean float64
	for _, v := range vals {
		mean += v
	}
	mean /= float64(len(vals))
	var sq float64
	for _, v := range vals {
		sq += (v - mean) * (v - mean)
	}
	return math.Sqrt(sq / float64(len(vals)-1))
}

// --- Trend ------------------------------------------------------------------

// bpTrendNoiseMmHg is the slope below which a trend isn't a finding. Blood
// pressure swings 5-10 mmHg day to day on nothing at all, so a fitted 30-day
// change inside this band is noise dressed as a direction.
const bpTrendNoiseMmHg = 3.0

const (
	BPTrendImproving = "improving"
	BPTrendStable    = "stable"
	BPTrendWorsening = "worsening"
)

// BPTrend fits an ordinary least-squares line through the daily means and
// returns the change per 30 days, mirroring how PaceLbsPerWeek reports weight.
// ok is false with fewer than three days of data, where a slope is meaningless.
func BPTrend(days []BPDay, since, now time.Time) (sysPer30d, diaPer30d float64, n int, ok bool) {
	type pt struct{ x, sys, dia float64 }
	pts := []pt{}
	for _, d := range days {
		if d.At.Before(since) || d.At.After(now) {
			continue
		}
		pts = append(pts, pt{
			x:   d.At.Sub(since).Hours() / 24,
			sys: d.Systolic,
			dia: d.Diastolic,
		})
	}
	if len(pts) < 3 {
		return 0, 0, len(pts), false
	}
	slope := func(get func(pt) float64) float64 {
		var sx, sy, sxy, sxx float64
		fn := float64(len(pts))
		for _, p := range pts {
			y := get(p)
			sx += p.x
			sy += y
			sxy += p.x * y
			sxx += p.x * p.x
		}
		den := fn*sxx - sx*sx
		if den == 0 {
			return 0
		}
		return (fn*sxy - sx*sy) / den
	}
	return slope(func(p pt) float64 { return p.sys }) * 30,
		slope(func(p pt) float64 { return p.dia }) * 30,
		len(pts), true
}

// ClassifyBPTrend labels a fitted slope. Systolic leads: it's the number that
// drives the category for most adults, and diastolic only overrides when it
// moves clearly while systolic doesn't.
func ClassifyBPTrend(sysPer30d, diaPer30d float64) string {
	switch {
	case sysPer30d <= -bpTrendNoiseMmHg:
		return BPTrendImproving
	case sysPer30d >= bpTrendNoiseMmHg:
		return BPTrendWorsening
	case diaPer30d <= -bpTrendNoiseMmHg:
		return BPTrendImproving
	case diaPer30d >= bpTrendNoiseMmHg:
		return BPTrendWorsening
	default:
		return BPTrendStable
	}
}

// --- Capture protocol --------------------------------------------------------

// Nudge keys. Stable identifiers so the UI copy and the tests can key off them
// without matching on prose.
const (
	BPNudgeCrisisReading    = "crisis_reading"
	BPNudgeNoReadings       = "no_readings"
	BPNudgeStale            = "stale"
	BPNudgeSparseWeek       = "sparse_week"
	BPNudgeSingleReadings   = "single_readings"
	BPNudgeNoMorning        = "no_morning"
	BPNudgeNoEvening        = "no_evening"
	BPNudgePostWorkoutHeavy = "post_workout_heavy"
	BPNudgeUnrested         = "unrested"
	BPNudgeHighVariability  = "high_variability"
)

const (
	BPSeverityInfo   = "info"
	BPSeverityWarn   = "warn"
	BPSeverityUrgent = "urgent"
)

// Thresholds for the protocol rules. Named rather than inline so the rules read
// as policy and can be tuned in one place.
const (
	bpStaleDays           = 10
	bpSparseWeekMinDays   = 4
	bpCrisisLookbackDays  = 7
	bpSingleReadingRatio  = 0.6 // share of days with only one session
	bpPostWorkoutRatio    = 0.4
	bpUnrestedRatio       = 0.5
	bpHighVariabilityMmHg = 12.0
	bpProtocolMinSessions = 3 // below this, coach frequency and nothing else
)

// BPNudge is one piece of capture guidance.
type BPNudge struct {
	Key      string `json:"key"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Severity string `json:"severity"`
}

// EvaluateBPProtocol decides what to tell the user about *how and when* they
// are measuring — the part of blood-pressure tracking that determines whether
// the numbers mean anything at all.
//
// This is the only place that defines "measuring properly", so the rules stay
// visible and testable, and produce identical guidance with or without an AI
// provider. Results are ordered most important first; callers typically show
// the top one or two.
func EvaluateBPProtocol(days []BPDay, sessions []BPSession, now time.Time) []BPNudge {
	out := []BPNudge{}

	if len(sessions) == 0 {
		return []BPNudge{{
			Key:      BPNudgeNoReadings,
			Title:    "Take your first reading",
			Detail:   "Sit quietly for five minutes with both feet flat and your arm supported at heart level, then measure. Two readings a minute apart, morning and evening, gives the clearest picture.",
			Severity: BPSeverityInfo,
		}}
	}

	// Crisis outranks everything, and is decided purely from the stored
	// readings — no AI provider involved, so this warning is identical on
	// every deployment.
	crisisCutoff := now.UTC().AddDate(0, 0, -bpCrisisLookbackDays)
	for _, s := range sessions {
		if s.Category == BPCategoryCrisis && !s.At.Before(crisisCutoff) {
			out = append(out, BPNudge{
				Key:      BPNudgeCrisisReading,
				Title:    "A recent reading was very high",
				Detail:   "You logged a reading above 180/120 in the last week. If a reading that high comes with chest pain, shortness of breath, weakness, trouble speaking, or vision changes, that is an emergency. Otherwise, rest five minutes, measure again, and contact a doctor if it stays there.",
				Severity: BPSeverityUrgent,
			})
			break
		}
	}

	last := sessions[len(sessions)-1]
	if daysSince := int(now.UTC().Sub(last.At).Hours() / 24); daysSince >= bpStaleDays {
		out = append(out, BPNudge{
			Key:      BPNudgeStale,
			Title:    "It's been a while",
			Detail:   fmt.Sprintf("Your last reading was %d days ago. A week of readings tells you far more than an occasional one — the average is what matters, and averages need data.", daysSince),
			Severity: BPSeverityWarn,
		})
	}

	// Frequency first: with barely any data, the other rules would be reading
	// tea leaves.
	weekCutoff := now.UTC().AddDate(0, 0, -6).Truncate(24 * time.Hour)
	daysThisWeek := 0
	for _, d := range days {
		if !d.At.Before(weekCutoff) {
			daysThisWeek++
		}
	}
	if daysThisWeek < bpSparseWeekMinDays {
		out = append(out, BPNudge{
			Key:      BPNudgeSparseWeek,
			Title:    "Measure on more days",
			Detail:   fmt.Sprintf("You measured on %d of the last 7 days. Aim for at least %d — categories are based on your average across several days, not on any single reading.", daysThisWeek, bpSparseWeekMinDays),
			Severity: BPSeverityInfo,
		})
	}

	if len(sessions) < bpProtocolMinSessions {
		return out
	}

	singleSessionDays, morningDays, eveningDays := 0, 0, 0
	for _, d := range days {
		if d.Readings == d.Sessions {
			singleSessionDays++
		}
		if d.Morning {
			morningDays++
		}
		if d.Evening {
			eveningDays++
		}
	}
	postWorkout, unrested := 0, 0
	for _, s := range sessions {
		if s.Context == models.BPContextPostWorkout {
			postWorkout++
		}
		if !s.Rested {
			unrested++
		}
	}
	nDays := float64(len(days))
	nSessions := float64(len(sessions))

	if float64(singleSessionDays)/nDays > bpSingleReadingRatio {
		out = append(out, BPNudge{
			Key:      BPNudgeSingleReadings,
			Title:    "Take two readings, not one",
			Detail:   "Most of your days have a single reading. Measure twice, a minute apart, and the app will average them — one reading carries enough random swing to move you a whole category.",
			Severity: BPSeverityInfo,
		})
	}
	if morningDays == 0 {
		out = append(out, BPNudge{
			Key:      BPNudgeNoMorning,
			Title:    "Add a morning reading",
			Detail:   "You haven't logged any morning readings. Morning measurements — before coffee, before exercise, before any medication — are the most comparable from day to day.",
			Severity: BPSeverityInfo,
		})
	} else if eveningDays == 0 {
		out = append(out, BPNudge{
			Key:      BPNudgeNoEvening,
			Title:    "Add an evening reading",
			Detail:   "All your readings are in the morning. Pairing them with an evening measurement shows how your pressure moves across the day.",
			Severity: BPSeverityInfo,
		})
	}
	if float64(postWorkout)/nSessions >= bpPostWorkoutRatio {
		out = append(out, BPNudge{
			Key:      BPNudgePostWorkoutHeavy,
			Title:    "Measure away from training",
			Detail:   "A lot of your readings are tagged post-workout. Blood pressure stays shifted for a while after exercise, so those readings don't compare cleanly — leave at least 30 minutes, ideally measure before training instead.",
			Severity: BPSeverityWarn,
		})
	}
	if float64(unrested)/nSessions > bpUnrestedRatio {
		out = append(out, BPNudge{
			Key:      BPNudgeUnrested,
			Title:    "Rest five minutes first",
			Detail:   "Most of your readings aren't marked as taken after five minutes of sitting quietly. Skipping that rest commonly reads 10 mmHg high, which is enough to change your category.",
			Severity: BPSeverityInfo,
		})
	}

	sysVals := make([]float64, 0, len(days))
	for _, d := range days {
		sysVals = append(sysVals, d.Systolic)
	}
	if sd := stdDev(sysVals); sd > bpHighVariabilityMmHg {
		out = append(out, BPNudge{
			Key:      BPNudgeHighVariability,
			Title:    "Your readings swing a lot",
			Detail:   fmt.Sprintf("Your daily averages vary by about %.0f mmHg. Some of that is normal, but measuring at the same times each day, after the same rest, removes most of the noise — and if it persists, it's worth mentioning to a doctor.", sd),
			Severity: BPSeverityInfo,
		})
	}

	return out
}

// FormatBPPair writes an averaged reading the conventional way. Rounding
// happens here, once, so the printed figure always matches the category
// computed from the same rounded values.
func FormatBPPair(sys, dia float64) string {
	return fmt.Sprintf("%.0f/%.0f", math.Round(sys), math.Round(dia))
}

// FormatFloat renders a value with a fixed number of decimals, for the
// preformatted MetricSummary.Value field.
func FormatFloat(v float64, decimals int) string {
	return strconv.FormatFloat(v, 'f', decimals, 64)
}
