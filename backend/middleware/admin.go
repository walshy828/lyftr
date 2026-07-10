package middleware

import (
	"slices"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// AdminOnly gates the /admin/* endpoints (exercise-library sync/reset) behind
// the ADMIN_EMAILS allow-list. Must run after Auth(), which stores the
// caller's email from the verified JWT. An empty allow-list means the admin
// surface is closed to everyone — deployments opt in explicitly rather than
// every authenticated user being able to, e.g., wipe the exercises table.
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		email, _ := c.Get(UserEmailKey)
		emailStr, _ := email.(string)
		if emailStr == "" || !slices.Contains(config.C.AdminEmails, emailStr) {
			utils.Forbidden(c, "admin access required")
			c.Abort()
			return
		}
		c.Next()
	}
}
