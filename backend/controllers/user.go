package controllers

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

func (h *Handler) GetMe(c *gin.Context) {
	uid := middleware.UserID(c)
	u, err := h.s.User.GetMe(uid)
	if err == sql.ErrNoRows {
		utils.Unauthorized(c, "account no longer exists")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, u)
}

func (h *Handler) GetSettings(c *gin.Context) {
	uid := middleware.UserID(c)
	s, err := h.s.User.GetSettings(uid)
	if err == sql.ErrNoRows {
		// No row yet — return the defaults.
		utils.OK(c, models.DefaultUserSettings(uid))
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, s)
}

func (h *Handler) UpdateSettings(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.UpdateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	// Enforce the request tags (weight_unit oneof, targets gte=0) like every other
	// controller — binding alone doesn't run them, so without this an invalid unit
	// or a negative target would be persisted unchecked.
	if err := validate.Struct(req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	// plan_history_start can't use a validator tag: "" is a meaningful value
	// (reset the progress view back to the journey start), and `omitempty`
	// only treats a nil pointer as absent, so a non-nil pointer to "" would
	// fail a datetime tag. Check the non-empty case explicitly instead.
	if req.PlanHistoryStart != nil && *req.PlanHistoryStart != "" {
		if _, err := time.Parse("2006-01-02", *req.PlanHistoryStart); err != nil {
			utils.BadRequest(c, "plan_history_start must be a YYYY-MM-DD date")
			return
		}
	}
	// The session-length ceiling is configurable, so it can't be a validator
	// tag. Reject rather than silently clamping: a user who asks for 365 days
	// and is quietly given 90 has no way to find out, and would reasonably
	// conclude the setting is broken when they're signed out in three months.
	if req.SessionMaxDays != nil && *req.SessionMaxDays > config.MaxSessionDays() {
		utils.BadRequest(c, fmt.Sprintf("session_max_days may not exceed %d on this server", config.MaxSessionDays()))
		return
	}
	s, err := h.s.User.UpsertSettings(uid, req)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, s)
}

// UpdateMe updates the user's editable account fields (currently the display
// name) and returns the refreshed user.
func (h *Handler) UpdateMe(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	u, err := h.s.User.UpdateName(uid, strings.TrimSpace(req.Name))
	if err == sql.ErrNoRows {
		utils.Unauthorized(c, "account no longer exists")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, u)
}

// ChangePassword rotates the caller's password and invalidates every session
// they hold, including this one — a password change that left stolen tokens
// working would defeat the point of changing it. The client is handed a fresh
// pair so the user isn't bounced to the login screen for doing the right thing.
//
// JWT-only: a personal access token is a machine credential and shouldn't be
// able to change the password protecting it, mirroring the rule in tokens.go.
func (h *Handler) ChangePassword(c *gin.Context) {
	uid := middleware.UserID(c)
	if method, _ := c.Get(middleware.AuthMethodKey); method != "jwt" {
		utils.Forbidden(c, "password changes require an interactive login")
		return
	}

	var req models.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	hash, err := h.s.User.GetPasswordHash(uid)
	if err == sql.ErrNoRows {
		utils.Unauthorized(c, "account no longer exists")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	// Confirming the current password stops a borrowed session from locking
	// the real owner out of their own account.
	if !utils.CheckPassword(req.CurrentPassword, hash) {
		utils.Unauthorized(c, "current password is incorrect")
		return
	}

	newHash, err := utils.HashPassword(req.NewPassword)
	if err != nil {
		utils.InternalError(c)
		return
	}
	version, err := h.s.User.UpdatePassword(uid, newHash)
	if utils.DBError(c, err) {
		return
	}

	user, err := h.s.User.GetMe(uid)
	if utils.DBError(c, err) {
		return
	}
	// The version bump above killed every session — retire the rows too, so the
	// account screen doesn't go on advertising
	// devices whose tokens are already dead.
	if err := h.s.DeviceSession.RevokeAllForUser(uid); err != nil {
		log.Printf("[user/password] revoke device sessions: %v", err)
	}

	// Issue a replacement session for the device that just changed the
	// password, so changing it doesn't sign you out of the app you're using.
	// GetMe doesn't carry token_version, and minting against a stale one would
	// hand back a pair that Auth rejects on the very next request.
	user.TokenVersion = version
	access, refresh, err := h.startSession(c, user, true)
	if err != nil {
		utils.InternalError(c)
		return
	}
	utils.OK(c, models.AuthResponse{Token: access, RefreshToken: refresh, User: user})
}

func (h *Handler) DeleteAccount(c *gin.Context) {
	uid := middleware.UserID(c)
	// Bump first: if the delete fails partway, the account's tokens are already
	// dead rather than still usable against a half-removed account.
	if _, err := h.s.User.BumpTokenVersion(uid); err != nil && err != sql.ErrNoRows {
		utils.DBError(c, err)
		return
	}
	if utils.DBError(c, h.s.User.Delete(uid)) {
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}
