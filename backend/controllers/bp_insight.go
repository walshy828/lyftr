package controllers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"

	"github.com/Cawlumm/lyftr-backend/config"
	"math"
	"time"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/Cawlumm/lyftr-backend/vision"
	"github.com/gin-gonic/gin"
)

// Tunables for the blood-pressure insight.
const (
	// bpInsightMinSessions / bpInsightMinDays: below this there is nothing to
	// interpret. An "insight" drawn from one or two readings is noise wearing
	// the costume of analysis, and blood pressure is the last place to do that.
	bpInsightMinSessions = 3
	bpInsightMinDays     = 2

	bpInsightGenerateTimeout = 60 * time.Second
	bpInsightWeightLogLimit  = 400
)

// buildBPInsightFacts assembles the deterministic picture. It composes existing
// stores rather than adding SQL — the same discipline as buildCheckinFacts, and
// the reason a new contributing signal usually costs nothing here.
func (h *Handler) buildBPInsightFacts(uid int64, now time.Time) (models.BPInsightFacts, []utils.BPSession, error) {
	var f models.BPInsightFacts
	f.GeneratedAt = now

	logs, err := h.s.BloodPressure.ListSince(uid, bpStatsLookbackDays)
	if err != nil {
		return f, nil, err
	}
	sessions := utils.GroupBPSessions(logs)
	days := utils.GroupBPDays(sessions)

	for _, w := range bpStatWindows {
		s := utils.SummarizeBPWindow(days, sessions, w, now)
		f.Windows = append(f.Windows, models.BPWindowFacts(s))
	}
	for _, d := range days {
		f.Daily = append(f.Daily, models.BPDayFacts{
			Day: d.Day, Systolic: d.Systolic, Diastolic: d.Diastolic, Pulse: d.Pulse,
			Sessions: d.Sessions, Readings: d.Readings, Category: d.Category,
			Morning: d.Morning, Evening: d.Evening,
		})
	}
	for _, n := range utils.EvaluateBPProtocol(days, sessions, now) {
		f.Nudges = append(f.Nudges, models.BPNudgeFacts(n))
	}

	// The 30-day window is the one the category is quoted from: long enough to
	// be stable, short enough to still describe the present.
	w30 := utils.SummarizeBPWindow(days, sessions, 30, now)
	f.Category = w30.Category
	f.WorstCategory = w30.WorstCategory

	f.SysPer30d, f.DiaPer30d, _, _ = utils.BPTrend(days, now.AddDate(0, 0, -bpStatsLookbackDays), now)
	f.TrendLabel = utils.ClassifyBPTrend(f.SysPer30d, f.DiaPer30d)

	if len(logs) > 0 {
		l := logs[len(logs)-1]
		l.Category = utils.ClassifyBP(l.Systolic, l.Diastolic)
		f.Latest = &l
	}

	// --- Contributing-factor context, all from existing stores ---

	wStats, err := h.s.Weight.Stats(uid)
	if err != nil {
		return f, sessions, err
	}
	wLogs, err := h.s.Weight.List(uid, stores.WeightFilter{Limit: bpInsightWeightLogLimit})
	if err != nil {
		return f, sessions, err
	}
	change90 := 0.0
	if len(wLogs) > 0 {
		if pace, _, ok := utils.PaceLbsPerWeek(wLogs, now.AddDate(0, 0, -90), now); ok {
			// PaceLbsPerWeek reports lbs LOST per week; express as signed change.
			change90 = -pace * (90.0 / 7.0)
		}
	}
	profile, err := h.s.Profile.Get(uid)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return f, sessions, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		profile = models.DefaultUserProfile(uid)
	}
	f.Profile = profile
	f.BMI = utils.BMI(wStats.Latest, profile.HeightInches)

	f.Weight = models.BPWeightContext{
		CurrentLbs:   wStats.Latest,
		Change30dLbs: wStats.Change30d,
		Change90dLbs: change90,
		BMICategory:  utils.BMICategory(f.BMI),
		Entries:      wStats.TotalEntries,
	}

	if f.Training.WorkoutDays30, err = h.s.Workout.CountSince(uid, 30); err != nil {
		return f, sessions, err
	}
	if f.Training.WorkoutDays90, err = h.s.Workout.CountSince(uid, 90); err != nil {
		return f, sessions, err
	}
	cardio30, err := h.s.Cardio.SummarySince(uid, 30)
	if err != nil {
		return f, sessions, err
	}
	f.Training.CardioDays30 = cardio30.Days
	f.Training.CardioSessions30 = cardio30.Sessions
	f.Training.CardioMinutes30 = cardio30.DurationMinutes

	// A user who has never opened Settings has no row; that's not an error, and
	// bailing out here would silently drop the nutrition context (and every
	// fact assembled after it) for exactly the newest users.
	settings, err := h.s.User.GetSettings(uid)
	if errors.Is(err, sql.ErrNoRows) {
		settings, err = models.DefaultUserSettings(uid), nil
	}
	if err != nil {
		return f, sessions, err
	}
	history, err := h.s.Food.History(uid, 30)
	if err != nil {
		return f, sessions, err
	}
	var sodiumSum float64
	for _, p := range history {
		sodiumSum += p.Sodium
	}
	f.Nutrition = models.BPNutritionContext{
		SodiumTargetMg: settings.SodiumTarget,
		DaysLogged30:   len(history),
	}
	// Averaged over days they actually logged, not over the calendar — a day
	// with no food logged is missing data, not a zero-sodium day.
	if len(history) > 0 {
		f.Nutrition.AvgSodiumMg = sodiumSum / float64(len(history))
	}

	// The extensibility slot: every metric with a Summary() lands here and
	// reaches the model with no prompt or schema change.
	f.OtherMetrics = h.healthMetricSummaries(uid, now)

	return f, sessions, nil
}

// RunBPInsight generates and stores a blood-pressure insight. Slow and
// explicitly user-triggered; never called on page load.
//
// With no AI provider, or when the provider fails, this still succeeds and
// stores the facts — the page renders every computed number either way, and
// only the written narrative is missing.
func (h *Handler) RunBPInsight(c *gin.Context) {
	uid := middleware.UserID(c)
	now := time.Now().UTC()

	facts, sessions, err := h.buildBPInsightFacts(uid, now)
	if utils.DBError(c, err) {
		return
	}

	distinctDays := map[string]struct{}{}
	for _, s := range sessions {
		distinctDays[s.LocalDay] = struct{}{}
	}
	if len(sessions) < bpInsightMinSessions || len(distinctDays) < bpInsightMinDays {
		utils.NotFound(c, "log a few more blood pressure readings first — an insight needs at least 3 readings across 2 days")
		return
	}

	factsJSON, err := json.Marshal(facts)
	if err != nil {
		utils.InternalError(c)
		return
	}

	reportJSON := ""
	if report, ok := h.generateBPReport(c, uid, facts); ok {
		if b, err := json.Marshal(report); err == nil {
			reportJSON = string(b)
		}
	}

	insight, err := h.s.BPInsight.Insert(uid, string(factsJSON), reportJSON)
	if utils.DBError(c, err) {
		return
	}
	decodeBPInsight(&insight)
	utils.OK(c, insight)
}

// generateBPReport calls the provider. It reports failure by returning ok=false
// rather than writing an error response: a missing narrative must never cost
// the user the facts we already computed.
func (h *Handler) generateBPReport(c *gin.Context, uid int64, facts models.BPInsightFacts) (models.BPInsightReport, bool) {
	if h.vision == nil {
		return models.BPInsightReport{}, false
	}
	// Two independent gates before any health data leaves the machine — see
	// healthInsightsAllowed.
	if !h.healthInsightsAllowed(uid) {
		return models.BPInsightReport{}, false
	}

	w := func(days int) models.BPWindowFacts {
		for _, x := range facts.Windows {
			if x.Days == days {
				return x
			}
		}
		return models.BPWindowFacts{}
	}
	w7, w30, w90 := w(7), w(30), w(90)

	age, _ := utils.AgeFromBirthDate(facts.Profile.BirthDate, facts.GeneratedAt)
	req := vision.BPInsightRequest{
		CurrentDate: facts.GeneratedAt.Format("2006-01-02"),
		Sex:         facts.Profile.Sex,
		Age:         age,

		Avg7Sys: math.Round(w7.AvgSystolic), Avg7Dia: math.Round(w7.AvgDiastolic),
		Avg30Sys: math.Round(w30.AvgSystolic), Avg30Dia: math.Round(w30.AvgDiastolic),
		Avg90Sys: math.Round(w90.AvgSystolic), Avg90Dia: math.Round(w90.AvgDiastolic),

		Category:      facts.Category,
		CategoryLabel: utils.BPCategoryLabel(facts.Category),
		WorstCategory: facts.WorstCategory,
		TrendLabel:    facts.TrendLabel,
		SysPer30d:     facts.SysPer30d,
		DiaPer30d:     facts.DiaPer30d,

		ReadingsLast30:     w30.Readings,
		DaysMeasuredLast30: w30.DaysWithData,
		SysStdDev30:        w30.SysStdDev,

		CurrentWeightLbs:    facts.Weight.CurrentLbs,
		WeightChange30dLbs:  facts.Weight.Change30dLbs,
		WeightChange90dLbs:  facts.Weight.Change90dLbs,
		BMICategory:         facts.Weight.BMICategory,
		WorkoutDaysLast30:   facts.Training.WorkoutDays30,
		CardioDaysLast30:    facts.Training.CardioDays30,
		CardioMinutesLast30: facts.Training.CardioMinutes30,
		AvgSodiumMg:         facts.Nutrition.AvgSodiumMg,
		SodiumTargetMg:      facts.Nutrition.SodiumTargetMg,
		DaysFoodLogged30:    facts.Nutrition.DaysLogged30,

		FactsJSON: redactedFactsJSON(facts),
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), bpInsightGenerateTimeout)
	defer cancel()

	out, err := h.vision.GenerateBPInsight(ctx, req)
	if err != nil {
		log.Printf("[blood-pressure/insight] vision error: %v", err)
		return models.BPInsightReport{}, false
	}

	report := models.BPInsightReport{
		Headline:      out.Headline,
		WhereYouStand: out.WhereYouStand,
		TrendReading:  out.TrendReading,
		SeeADoctor:    out.SeeADoctor,
		Outlook:       out.Outlook,
	}
	for _, x := range out.Contributors {
		report.Contributors = append(report.Contributors, models.BPContributor(x))
	}
	for _, x := range out.ActionPlan {
		report.ActionPlan = append(report.ActionPlan, models.BPActionStep(x))
	}
	for _, x := range out.MeasurementTips {
		report.MeasurementTips = append(report.MeasurementTips, models.CheckinPoint(x))
	}
	return report, true
}

// GetLatestBPInsight reads the stored insight. Reading must never generate —
// that would spend an AI call on a page load.
func (h *Handler) GetLatestBPInsight(c *gin.Context) {
	uid := middleware.UserID(c)
	insight, err := h.s.BPInsight.Latest(uid)
	if errors.Is(err, sql.ErrNoRows) {
		utils.NotFound(c, "no blood pressure insight yet")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	decodeBPInsight(&insight)
	utils.OK(c, insight)
}

// decodeBPInsight expands the stored JSON columns into their typed forms.
// A report is left nil when it was never generated, which is what the client
// keys its "needs an AI provider" notice off.
func decodeBPInsight(i *models.BPInsight) {
	if i.FactsJSON != "" {
		var f models.BPInsightFacts
		if err := json.Unmarshal([]byte(i.FactsJSON), &f); err == nil {
			i.Facts = &f
		}
	}
	if i.ReportJSON != "" {
		var r models.BPInsightReport
		if err := json.Unmarshal([]byte(i.ReportJSON), &r); err == nil {
			i.Report = &r
		}
	}
}

// Compile-time guards that the models and vision shapes stay identical. Adding
// a field on one side without the other fails the build here rather than
// silently dropping out of the stored report.
var (
	_ = models.BPContributor(vision.BPContributor{})
	_ = models.BPActionStep(vision.BPActionStep{})
	_ = models.BPWindowFacts(utils.BPWindow{})
	_ = models.BPNudgeFacts(utils.BPNudge{})
)

// redactedFactsJSON is the blob pasted verbatim into the provider prompt. It is
// deliberately NOT the same JSON stored in bp_insights: the stored copy is the
// full record for the user's own use, while this one drops direct identifiers
// that the model doesn't need to reason about blood pressure.
//
// Specifically, the raw UserProfile is removed — it carries an exact birth date
// and height. Age is already sent as an integer on the request alongside sex,
// which is what the clinical reasoning actually needs; a date of birth is a
// strong identifier and adds nothing. On a marshalling failure we send an empty
// string rather than falling back to the unredacted blob: losing prompt context
// degrades the narrative, leaking a birth date can't be undone.
func redactedFactsJSON(facts models.BPInsightFacts) string {
	redacted := facts
	redacted.Profile = models.UserProfile{}
	b, err := json.Marshal(redacted)
	if err != nil {
		log.Printf("[blood-pressure/insight] redact facts: %v", err)
		return ""
	}
	return string(b)
}

// healthInsightsAllowed reports whether this user's health data may be sent to
// the configured third-party LLM. Both gates must pass: the operator flag
// (AI_HEALTH_INSIGHTS_ENABLED, deliberately separate from VisionProvider so
// that enabling meal-photo scanning doesn't silently start exporting blood
// pressure records) and the user's own opt-in, because consent to send one's
// own health data can't be given by whoever runs the server. Fails closed on
// any lookup error — the default answer to "may we export health data?" is no.
func (h *Handler) healthInsightsAllowed(uid int64) bool {
	if !config.C.AIHealthInsightsEnabled {
		return false
	}
	settings, err := h.s.User.GetSettings(uid)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		log.Printf("[ai-health-consent] settings lookup: %v", err)
		return false
	}
	return settings.AIHealthInsightsOptIn
}
