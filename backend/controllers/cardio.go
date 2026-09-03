package controllers

import (
	"database/sql"
	"strconv"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

func (h *Handler) ListCardioSessions(c *gin.Context) {
	uid := middleware.UserID(c)
	f := stores.CardioFilter{Limit: 90}
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 && l <= 1000 {
		f.Limit = l
	}
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		f.Offset = o
	}

	sessions, err := h.s.Cardio.List(uid, f)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, sessions)
}

// ImportCardioSessions accepts a batch of cardio sessions from a sync job
// (e.g. the Android companion app reading Health Connect). Safe to call
// repeatedly with overlapping batches — sessions are upserted on external_id,
// so a resubmitted session (e.g. recategorized in Health Connect) overwrites
// the existing row instead of being ignored.
func (h *Handler) ImportCardioSessions(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.BatchImportCardioSessionsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	imported, updated, err := h.s.Cardio.Import(uid, req.Sessions)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, gin.H{"imported": imported, "updated": updated, "submitted": len(req.Sessions)})
}

func (h *Handler) GetCardioSession(c *gin.Context) {
	uid := middleware.UserID(c)
	sid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	session, err := h.s.Cardio.Get(uid, sid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "cardio session not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, session)
}

// GetCardioSessionZones enriches one cardio session with a heart-rate-zone
// breakdown and max observed BPM computed over its own [started_at, ended_at]
// window, for a workout drill-down view. Requires either ?max_hr= or a birth
// date set in the user's profile — see resolveMaxHR.
func (h *Handler) GetCardioSessionZones(c *gin.Context) {
	uid := middleware.UserID(c)
	sid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	session, err := h.s.Cardio.Get(uid, sid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "cardio session not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}

	maxHR, ok := h.resolveMaxHR(c, uid)
	if !ok {
		utils.BadRequest(c, "max_hr is required, or set a birth date in your profile so it can be estimated")
		return
	}

	detail := models.CardioSessionDetail{CardioSession: session}
	zones, maxBPM, err := h.s.HeartRate.ZoneMinutesForSession(uid, session.StartedAt, session.EndedAt, maxHR)
	if utils.DBError(c, err) {
		return
	}
	if maxBPM > 0 {
		detail.Zones = &zones
		detail.MaxObservedBPM = maxBPM
	}
	utils.OK(c, detail)
}

func (h *Handler) DeleteCardioSession(c *gin.Context) {
	uid := middleware.UserID(c)
	sid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	n, err := h.s.Cardio.Delete(uid, sid)
	if utils.DBError(c, err) {
		return
	}
	if n == 0 {
		utils.NotFound(c, "cardio session not found")
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}
