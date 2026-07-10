package controllers

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

const maxActiveSessionBytes = 128 * 1024

// GetActiveSession returns the caller's saved session blob. The store treats
// "data" as an opaque, client-defined JSON string (e.g. an ActiveSession
// object as serialized by the web app or Android phone companion) — the
// backend never parses or validates its shape.
func (h *Handler) GetActiveSession(c *gin.Context) {
	uid := middleware.UserID(c)
	data, updatedAt, err := h.s.ActiveSession.Get(uid)
	if err == sql.ErrNoRows {
		utils.OK(c, nil)
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{"data": data, "updated_at": updatedAt})
}

func (h *Handler) UpsertActiveSession(c *gin.Context) {
	uid := middleware.UserID(c)
	var body struct {
		Data string `json:"data" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	// The blob is opaque but not a dumping ground — a real session is a few
	// KB, so anything huge is a bug or abuse, not a workout.
	if len(body.Data) > maxActiveSessionBytes {
		utils.BadRequest(c, "session data too large")
		return
	}
	if utils.DBError(c, h.s.ActiveSession.Upsert(uid, body.Data)) {
		return
	}
	utils.OK(c, gin.H{"saved": true})
}

func (h *Handler) DeleteActiveSession(c *gin.Context) {
	uid := middleware.UserID(c)
	if utils.DBError(c, h.s.ActiveSession.Delete(uid)) {
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}
