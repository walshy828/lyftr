package controllers

import (
	"database/sql"
	"strconv"
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

// resolveMaxHR takes an explicit ?max_hr= override if present, otherwise
// estimates it from the user's profile birth date (220-age, the standard
// estimate). Returns ok=false when neither is available — the caller must
// have set a birth date in their profile or pass max_hr explicitly, since a
// silently wrong default would make every zone-minutes number meaningless.
func (h *Handler) resolveMaxHR(c *gin.Context, uid int64) (maxHR int, ok bool) {
	if raw := c.Query("max_hr"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			return v, true
		}
	}
	profile, err := h.s.Profile.Get(uid)
	if err != nil {
		return 0, false
	}
	age, hasAge := utils.AgeFromBirthDate(profile.BirthDate, time.Now())
	if !hasAge {
		return 0, false
	}
	return 220 - age, true
}

// GetHeartRateZones returns per-day time-in-zone minutes (the standard
// 5-zone model, as a percentage of max HR). Requires either ?max_hr= or a
// birth date set in the user's profile — see resolveMaxHR.
func (h *Handler) GetHeartRateZones(c *gin.Context) {
	uid := middleware.UserID(c)
	maxHR, ok := h.resolveMaxHR(c, uid)
	if !ok {
		utils.BadRequest(c, "max_hr is required, or set a birth date in your profile so it can be estimated")
		return
	}
	from, to := parseFromTo(c)
	zones, err := h.s.HeartRate.ZoneMinutes(uid, from, to, maxHR)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, zones)
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
