package controllers

import (
	"crypto/subtle"
	"database/sql"
	"log"
	"strings"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/middleware"
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

	// A fresh user starts at token_version 0.
	access, refresh, err := utils.GenerateTokenPair(userID, req.Email, 0)
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

	access, refresh, err := utils.GenerateTokenPair(user.ID, user.Email, user.TokenVersion)
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

	// Revoked individually (logout) or wholesale (password change)?
	if !middleware.TokenStillValid(h.s, claims) {
		utils.Unauthorized(c, "invalid refresh token")
		return
	}

	version, err := h.s.User.TokenVersion(claims.UserID)
	if utils.DBError(c, err) {
		return
	}

	access, refresh, err := utils.GenerateTokenPair(claims.UserID, claims.Email, version)
	if err != nil {
		utils.InternalError(c)
		return
	}

	// Rotation: the presented refresh token is spent. Without this a single
	// stolen token is usable for its whole lifetime; with it, a replay lands on
	// an already-revoked jti and fails, which is also the signal that the token
	// leaked. Revoked after minting so a failure here can't strand the caller
	// with no working credentials.
	if claims.ExpiresAt != nil {
		if err := h.s.Token.RevokeJWT(claims.ID, claims.UserID, claims.ExpiresAt.Time); err != nil {
			log.Printf("[auth/refresh] revoke spent token: %v", err)
		}
	}

	utils.OK(c, gin.H{"token": access, "refresh_token": refresh})
}

// Logout revokes the caller's tokens. The access token comes from the
// Authorization header (this route is authenticated) and the refresh token from
// the body; both are denied by jti so other devices keep their sessions.
// Best-effort by design: a client that has already discarded its tokens should
// still get a 200 rather than an error it can do nothing about.
func (h *Handler) Logout(c *gin.Context) {
	uid := middleware.UserID(c)

	revoke := func(tokenStr string) {
		claims, err := utils.ValidateToken(tokenStr)
		if err != nil || claims.UserID != uid || claims.ExpiresAt == nil {
			return
		}
		if err := h.s.Token.RevokeJWT(claims.ID, uid, claims.ExpiresAt.Time); err != nil {
			log.Printf("[auth/logout] revoke: %v", err)
		}
	}

	revoke(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))

	var req models.RefreshRequest
	if err := c.ShouldBindJSON(&req); err == nil && req.RefreshToken != "" {
		revoke(req.RefreshToken)
	}

	utils.OK(c, gin.H{"logged_out": true})
}
