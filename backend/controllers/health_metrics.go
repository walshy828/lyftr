package controllers

import (
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

func (h *Handler) ListHealthMetrics(c *gin.Context) {
	uid := middleware.UserID(c)
	from, to := parseFromTo(c)
	metrics, err := h.s.HealthMetric.List(uid, c.Query("metric_type"), from, to)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, metrics)
}

// ImportHealthMetrics accepts a batch of scalar health metrics (HRV, SpO2,
// resting heart rate, active calories, VO2 max, floors climbed) from a sync
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
