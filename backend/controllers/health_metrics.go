package controllers

import (
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// validHealthMetricTypes is the allowlist GetHealthMetricsDaily validates
// metric_type against, mirroring the MetricType* constants in models.go.
var validHealthMetricTypes = map[string]bool{
	models.MetricTypeHRVRMSSD:         true,
	models.MetricTypeSpO2:             true,
	models.MetricTypeRestingHeartRate: true,
	models.MetricTypeActiveCalories:   true,
	models.MetricTypeVO2Max:           true,
	models.MetricTypeFloorsClimbed:    true,
	models.MetricTypeSteps:            true,
}

// defaultAggFor picks the natural rollup for a metric_type when the caller
// doesn't specify ?agg=: steps are a cumulative count so a day sums them,
// everything else is a point-in-time reading so a day averages them.
func defaultAggFor(metricType string) string {
	if metricType == models.MetricTypeSteps {
		return "sum"
	}
	return "avg"
}

func (h *Handler) ListHealthMetrics(c *gin.Context) {
	uid := middleware.UserID(c)
	from, to := parseFromTo(c)
	metrics, err := h.s.HealthMetric.List(uid, c.Query("metric_type"), from, to)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, metrics)
}

// GetHealthMetricsDaily returns per-day rollups of one metric_type over a
// date window (?metric_type=&from=&to=&tz_offset=&agg=avg|sum). agg defaults
// by metric_type when omitted (steps sum, everything else averages) — see
// defaultAggFor.
func (h *Handler) GetHealthMetricsDaily(c *gin.Context) {
	uid := middleware.UserID(c)
	metricType := c.Query("metric_type")
	if metricType == "" || !validHealthMetricTypes[metricType] {
		utils.BadRequest(c, "metric_type is required and must be a known metric type")
		return
	}

	agg := c.Query("agg")
	if agg == "" {
		agg = defaultAggFor(metricType)
	}
	if agg != "avg" && agg != "sum" {
		utils.BadRequest(c, "agg must be avg or sum")
		return
	}

	from, to, tzOffset, _, ok := parseStatsWindow(c)
	if !ok {
		return
	}

	stats, err := h.s.HealthMetric.DailyStats(uid, metricType, from, to, tzOffset, agg)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, stats)
}

// ImportHealthMetrics accepts a batch of scalar health metrics (HRV, SpO2,
// resting heart rate, active calories, VO2 max, floors climbed, steps) from a sync
// job (e.g. the Android companion app reading Health Connect). Safe to call
// repeatedly — metrics are upserted on (metric_type, external_id).
func (h *Handler) ImportHealthMetrics(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.BatchImportHealthMetricsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	imported, updated, err := h.s.HealthMetric.Import(uid, req.Metrics)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, gin.H{"imported": imported, "updated": updated, "submitted": len(req.Metrics)})
}
