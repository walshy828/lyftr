package controllers

import (
	"log"
	"time"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// bpMetricProvider is the shape every tracked health metric exposes: given a
// user and a moment, one card-sized readout.
type metricProvider func(uid int64, now time.Time) (models.MetricSummary, error)

// healthMetricProviders is the extensibility seam.
//
// A new metric — resting HR, waist, sleep — joins the health hub, the summary
// endpoint, and the blood-pressure insight's context by appending one line
// here and writing its Summary method. Nothing else changes.
//
// Deliberately NOT generic: the tables, the validation, and the classifiers
// stay per-metric and strongly typed. Genericity belongs at the presentation
// boundary, not in the schema.
func (h *Handler) healthMetricProviders() []metricProvider {
	return []metricProvider{
		h.weightSummary,
		h.bloodPressureSummary,
		// h.restingHRSummary,
	}
}

// healthMetricSummaries runs every provider, skipping any that error. One
// metric failing must not blank the hub or break an insight run.
func (h *Handler) healthMetricSummaries(uid int64, now time.Time) []models.MetricSummary {
	out := []models.MetricSummary{}
	for _, p := range h.healthMetricProviders() {
		s, err := p(uid, now)
		if err != nil {
			log.Printf("[health/summary] metric provider error: %v", err)
			continue
		}
		if s.Readings == 0 {
			continue
		}
		out = append(out, s)
	}
	return out
}

func (h *Handler) GetHealthSummary(c *gin.Context) {
	uid := middleware.UserID(c)
	utils.OK(c, h.healthMetricSummaries(uid, time.Now().UTC()))
}

// weightSummary wraps the existing WeightStore.Stats — no new SQL.
func (h *Handler) weightSummary(uid int64, now time.Time) (models.MetricSummary, error) {
	stats, err := h.s.Weight.Stats(uid)
	if err != nil || stats.TotalEntries == 0 {
		return models.MetricSummary{}, err
	}
	return models.MetricSummary{
		Key:   "weight",
		Label: "Weight",
		// Preformatted in lbs; the client converts for display using the same
		// settings helpers every other weight figure goes through.
		Value:         utils.FormatFloat(stats.Latest, 1),
		Unit:          "lbs",
		Tone:          "neutral",
		Change:        stats.Change30d,
		ChangeDays:    30,
		LowerIsBetter: true,
		Readings:      stats.TotalEntries,
	}, nil
}

func (h *Handler) bloodPressureSummary(uid int64, now time.Time) (models.MetricSummary, error) {
	logs, err := h.s.BloodPressure.ListSince(uid, 30)
	if err != nil || len(logs) == 0 {
		return models.MetricSummary{}, err
	}
	sessions := utils.GroupBPSessions(logs)
	days := utils.GroupBPDays(sessions)
	w := utils.SummarizeBPWindow(days, sessions, 30, now)

	tone := "neutral"
	switch w.Category {
	case utils.BPCategoryNormal:
		tone = "good"
	case utils.BPCategoryElevated, utils.BPCategoryLow:
		tone = "watch"
	case utils.BPCategoryStage1, utils.BPCategoryStage2, utils.BPCategoryCrisis:
		tone = "bad"
	}

	sysPer30d, diaPer30d, _, _ := utils.BPTrend(days, now.AddDate(0, 0, -30), now)
	_ = diaPer30d

	return models.MetricSummary{
		Key:   "blood_pressure",
		Label: "Blood Pressure",
		// The 30-day average, not the latest reading — the same number the
		// category is based on everywhere else in the app.
		Value:         utils.FormatBPPair(w.AvgSystolic, w.AvgDiastolic),
		Unit:          "mmHg",
		Category:      w.Category,
		Tone:          tone,
		Change:        sysPer30d,
		ChangeDays:    30,
		LowerIsBetter: true,
		LastLoggedAt:  logs[len(logs)-1].LoggedAt,
		Readings:      w.Readings,
	}, nil
}
