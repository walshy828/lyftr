package controllers

import (
	"database/sql"
	"time"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// parseFromTo applies weight.go's parseDayOrTime day-widening convention to a
// pair of query params, returning nullable bounds suitable for the store layer.
func parseFromTo(c *gin.Context) (from, to sql.NullTime) {
	if raw := c.Query("from"); raw != "" {
		if t, exact, ok := parseDayOrTime(raw); ok {
			if !exact {
				t = t.Add(-12 * time.Hour)
			}
			from = sql.NullTime{Time: t, Valid: true}
		}
	}
	if raw := c.Query("to"); raw != "" {
		if t, exact, ok := parseDayOrTime(raw); ok {
			if !exact {
				t = t.Add(36 * time.Hour)
			}
			to = sql.NullTime{Time: t, Valid: true}
		}
	}
	return from, to
}

func (h *Handler) ListHeartRateSamples(c *gin.Context) {
	uid := middleware.UserID(c)
	from, to := parseFromTo(c)
	samples, err := h.s.HeartRate.List(uid, from, to)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, samples)
}

func (h *Handler) GetHeartRateDailyStats(c *gin.Context) {
	uid := middleware.UserID(c)
	from, to := parseFromTo(c)
	stats, err := h.s.HeartRate.DailyStats(uid, from, to)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, stats)
}

// ImportHeartRateSamples accepts a batch of raw heart rate samples from a
// sync job (e.g. the Android companion app reading Health Connect). Safe to
// call repeatedly — samples are upserted on external_id.
func (h *Handler) ImportHeartRateSamples(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.BatchImportHeartRateSamplesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	imported, updated, err := h.s.HeartRate.Import(uid, req.Samples)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, gin.H{"imported": imported, "updated": updated, "submitted": len(req.Samples)})
}
