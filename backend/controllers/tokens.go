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

// requireJWT rejects PAT-authenticated callers. A personal access token must
// never be usable to mint, list, or revoke tokens — including itself —
// otherwise a leaked token could self-perpetuate access after being revoked.
func requireJWT(c *gin.Context) bool {
	if c.GetString(middleware.AuthMethodKey) != "jwt" {
		utils.Forbidden(c, "token management requires an interactive login")
		return false
	}
	return true
}

func (h *Handler) ListTokens(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	uid := middleware.UserID(c)
	tokens, err := h.s.Token.List(uid)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, tokens)
}

func (h *Handler) CreateToken(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	uid := middleware.UserID(c)

	var req models.CreateTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	var expiresAt *time.Time
	if req.ExpiresInDays != nil {
		t := time.Now().UTC().AddDate(0, 0, *req.ExpiresInDays)
		expiresAt = &t
	}

	plaintext, hash, prefix, err := utils.GeneratePAT()
	if err != nil {
		utils.InternalError(c)
		return
	}

	token, err := h.s.Token.Create(uid, req.Name, hash, prefix, expiresAt)
	if utils.DBError(c, err) {
		return
	}

	utils.Created(c, models.CreateTokenResponse{Token: token, Value: plaintext})
}

func (h *Handler) RevokeToken(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	uid := middleware.UserID(c)

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	err = h.s.Token.Revoke(uid, id)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "token not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{"revoked": true})
}
