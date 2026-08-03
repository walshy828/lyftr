package controllers

import (
	"database/sql"
	"strings"
	"time"

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

func (h *Handler) DeleteAccount(c *gin.Context) {
	uid := middleware.UserID(c)
	if utils.DBError(c, h.s.User.Delete(uid)) {
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}
