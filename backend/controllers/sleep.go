package controllers

import (
	"database/sql"
	"strconv"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

func (h *Handler) ListSleepSessions(c *gin.Context) {
	uid := middleware.UserID(c)
	from, to := parseFromTo(c)
	sessions, err := h.s.Sleep.List(uid, from, to)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, sessions)
}

func (h *Handler) GetSleepSession(c *gin.Context) {
	uid := middleware.UserID(c)
	sid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	session, err := h.s.Sleep.Get(uid, sid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "sleep session not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, session)
}

// ImportSleepSessions accepts a batch of sleep sessions (with stage detail)
// from a sync job (e.g. the Android companion app reading Health Connect).
// Safe to call repeatedly — sessions are upserted on external_id, with their
// stages replaced wholesale on each resubmit.
func (h *Handler) ImportSleepSessions(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.BatchImportSleepSessionsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	imported, updated, err := h.s.Sleep.Import(uid, req.Sessions)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, gin.H{"imported": imported, "updated": updated, "submitted": len(req.Sessions)})
}
