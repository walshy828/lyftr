package controllers

import (
	"crypto/subtle"
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

var validate = validator.New()

// A valid bcrypt hash of a random throwaway string, compared against when the
// login email doesn't exist — see the timing note in Login.
const dummyBcryptHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

func (h *Handler) Register(c *gin.Context) {
	// Checked before binding so a closed instance gives an attacker nothing at
	// all — no validation feedback, no email-existence oracle, no bcrypt work.
	// The empty-instance exception keeps a fresh deployment from locking itself
	// out: with no accounts there is nothing to protect, and the window closes
	// the moment the first user is created.
	if !config.C.AllowRegistration {
		empty, err := h.s.User.IsEmpty()
		if utils.DBError(c, err) {
			return
		}
		if !empty {
			utils.Forbidden(c, "registration is closed on this server")
			return
		}
	}

	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	// Constant-time so the code can't be recovered a character at a time.
	if len(config.C.RegistrationInviteCode) > 0 &&
		subtle.ConstantTimeCompare([]byte(req.InviteCode), config.C.RegistrationInviteCode) != 1 {
		utils.Forbidden(c, "invalid invite code")
		return
	}

	hash, err := utils.HashPassword(req.Password)
	if err != nil {
		utils.InternalError(c)
		return
	}

	userID, err := h.s.User.Create(req.Email, hash)
	if utils.IsUniqueViolation(err) {
		utils.Conflict(c, "email already registered")
		return
	}
	if utils.DBError(c, err) {
		return
	}

	access, refresh, err := utils.GenerateTokenPair(userID, req.Email)
	if err != nil {
		utils.InternalError(c)
		return
	}

	// Reload the persisted row so the response carries the real created_at
	// (and default name) rather than a zero-value time — a zero CreatedAt
	// renders as a bogus date in the client's "Member since".
	user, err := h.s.User.GetMe(userID)
	if err != nil {
		user = models.User{ID: userID, Email: req.Email}
	}
	utils.Created(c, models.AuthResponse{Token: access, RefreshToken: refresh, User: user})
}

func (h *Handler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	user, err := h.s.User.GetByEmail(req.Email)
	if err == sql.ErrNoRows {
		// Burn the same bcrypt cost as a real comparison so "unknown email"
		// and "wrong password" are indistinguishable by response time.
		utils.CheckPassword(req.Password, dummyBcryptHash)
		utils.Unauthorized(c, "invalid email or password")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	if !utils.CheckPassword(req.Password, user.Password) {
		utils.Unauthorized(c, "invalid email or password")
		return
	}

	access, refresh, err := utils.GenerateTokenPair(user.ID, user.Email)
	if err != nil {
		utils.InternalError(c)
		return
	}

	user.Password = ""
	utils.OK(c, models.AuthResponse{Token: access, RefreshToken: refresh, User: user})
}

func (h *Handler) RefreshToken(c *gin.Context) {
	var req models.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	claims, err := utils.ValidateToken(req.RefreshToken)
	if err != nil || claims.Type != "refresh" {
		utils.Unauthorized(c, "invalid refresh token")
		return
	}

	access, refresh, err := utils.GenerateTokenPair(claims.UserID, claims.Email)
	if err != nil {
		utils.InternalError(c)
		return
	}

	utils.OK(c, gin.H{"token": access, "refresh_token": refresh})
}
