package controllers

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// ListSessions returns the user's signed-in devices. JWT-only, mirroring the
// rule in tokens.go: a personal access token is a machine credential and must
// not be able to enumerate or sign out its owner's interactive sessions.
func (h *Handler) ListSessions(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	uid := middleware.UserID(c)

	sessions, err := h.s.DeviceSession.List(uid)
	if utils.DBError(c, err) {
		return
	}

	current := middleware.SessionID(c)
	for i := range sessions {
		sessions[i].Current = sessions[i].ID == current
	}
	utils.OK(c, sessions)
}

// RevokeSession signs out one device. Scoped to the caller's own sessions by
// the store's WHERE clause, so a guessed id can't reach another account.
//
// Takes effect on that device within one access-token lifetime rather than
// instantly — the liveness check runs on refresh, not on every request. See
// DeviceSessionStore.IsLive for the reasoning.
func (h *Handler) RevokeSession(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	uid := middleware.UserID(c)

	err := h.s.DeviceSession.Revoke(c.Param("id"), uid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "session not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{"revoked": true})
}
