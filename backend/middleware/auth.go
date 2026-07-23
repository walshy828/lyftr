package middleware

import (
	"strings"

	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

const UserIDKey = "user_id"
const UserEmailKey = "user_email"

// AuthMethodKey records how the caller authenticated ("jwt" or "pat"). Handlers
// that must stay JWT-only (e.g. token management itself) check this.
const AuthMethodKey = "auth_method"

const patTokenPrefix = "lyftr_pat_"

// Auth accepts either a JWT access token (the SPA's login flow) or a personal
// access token (for non-interactive clients like the MCP server), dispatched
// by prefix since the two formats are unambiguous at a glance — branching on
// prefix skips a wasted JWT parse/signature-verify attempt on a token that's
// obviously not a JWT.
func Auth(s *stores.Stores) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			utils.Unauthorized(c, "missing or invalid authorization header")
			c.Abort()
			return
		}
		token := strings.TrimPrefix(header, "Bearer ")

		if strings.HasPrefix(token, patTokenPrefix) {
			authenticatePAT(c, s, token)
			return
		}

		claims, err := utils.ValidateToken(token)
		if err != nil {
			utils.Unauthorized(c, "invalid or expired token")
			c.Abort()
			return
		}

		if claims.Type != "access" {
			utils.Unauthorized(c, "invalid token type")
			c.Abort()
			return
		}

		c.Set(UserIDKey, claims.UserID)
		c.Set(UserEmailKey, claims.Email)
		c.Set(AuthMethodKey, "jwt")
		c.Next()
	}
}

func authenticatePAT(c *gin.Context, s *stores.Stores, token string) {
	id, userID, err := s.Token.GetActiveByHash(utils.HashPAT(token))
	if err != nil {
		// Same generic message as a bad JWT — don't leak whether the token is
		// unknown, revoked, or expired.
		utils.Unauthorized(c, "invalid or expired token")
		c.Abort()
		return
	}
	go s.Token.TouchLastUsed(id) // best-effort; must not add latency or fail auth

	c.Set(UserIDKey, userID)
	c.Set(AuthMethodKey, "pat")
	c.Next()
}

func UserID(c *gin.Context) int64 {
	id, _ := c.Get(UserIDKey)
	v, _ := id.(int64)
	return v
}
