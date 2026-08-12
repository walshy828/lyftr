package controllers

import (
	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/passkey"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// ServerInfo is a public, unauthenticated endpoint clients use to verify that a
// configured server URL is reachable and is actually a Lyftr backend — the
// "test connection" behind the in-app server selector. It runs under the same
// CORS policy as the rest of the API, so a successful probe honestly predicts
// that authenticated requests from the same origin will be allowed too.
func (h *Handler) ServerInfo(c *gin.Context) {
	utils.OK(c, gin.H{
		"name":    "lyftr",
		"version": config.C.Version,
		// Whether this server has a WebAuthn Relying Party configured. The login
		// page needs it before anyone is authenticated, to decide whether to
		// offer "Sign in with a passkey" at all — a button that can only fail is
		// worse than no button. It leaks nothing: it's a property of the
		// deployment, not of any account.
		"passkeys_enabled": passkey.Enabled(),
	})
}
