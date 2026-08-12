package controllers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

func TestUpsertActiveSessionSizeCap(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// Oversized blob is rejected before touching the database.
	c, w := newContext(uid, http.MethodPut, "/api/v1/active-session",
		map[string]string{"data": strings.Repeat("x", maxActiveSessionBytes+1)})
	th.UpsertActiveSession(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("oversized blob: got %d, want 400", w.Code)
	}

	// A normal-sized session still saves.
	c, w = newContext(uid, http.MethodPut, "/api/v1/active-session",
		map[string]string{"data": `{"name":"Push Day"}`})
	th.UpsertActiveSession(c)
	if w.Code != http.StatusOK {
		t.Fatalf("normal blob: got %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
}

func TestAdminOnlyMiddleware(t *testing.T) {
	orig := config.C
	config.C = &config.Config{AdminEmails: []string{"admin@example.com"}}
	t.Cleanup(func() { config.C = orig })

	handler := middleware.AdminOnly()

	c, w := newContext(1, http.MethodPost, "/api/v1/admin/reset-exercises", nil)
	c.Set(middleware.UserEmailKey, "user@example.com")
	handler(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-admin: got %d, want 403", w.Code)
	}
	if !c.IsAborted() {
		t.Fatal("non-admin request was not aborted")
	}

	c, w = newContext(1, http.MethodPost, "/api/v1/admin/reset-exercises", nil)
	c.Set(middleware.UserEmailKey, "admin@example.com")
	handler(c)
	if c.IsAborted() {
		t.Fatalf("admin request was aborted (status %d)", w.Code)
	}

	// Empty allow-list closes the admin surface to everyone.
	config.C = &config.Config{}
	c, w = newContext(1, http.MethodPost, "/api/v1/admin/reset-exercises", nil)
	c.Set(middleware.UserEmailKey, "admin@example.com")
	handler(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("empty allow-list: got %d, want 403", w.Code)
	}
}

func TestAuthRateLimit(t *testing.T) {
	handler := middleware.RateLimit(3, time.Minute)

	for i := 1; i <= 3; i++ {
		c, w := newContext(0, http.MethodPost, "/api/v1/auth/login", nil)
		c.Request.RemoteAddr = "10.0.0.1:1234"
		handler(c)
		if c.IsAborted() {
			t.Fatalf("request %d aborted early (status %d)", i, w.Code)
		}
	}

	c, w := newContext(0, http.MethodPost, "/api/v1/auth/login", nil)
	c.Request.RemoteAddr = "10.0.0.1:1234"
	handler(c)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request: got %d, want 429", w.Code)
	}

	// A different IP has its own bucket.
	c, w = newContext(0, http.MethodPost, "/api/v1/auth/login", nil)
	c.Request.RemoteAddr = "10.0.0.2:1234"
	handler(c)
	if c.IsAborted() {
		t.Fatalf("other IP was limited (status %d)", w.Code)
	}
}

func TestSeedDemoConfigGating(t *testing.T) {
	load := func(env, seedDemo string) bool {
		t.Setenv("ENV", env)
		t.Setenv("SEED_DEMO", seedDemo)
		orig := config.C
		defer func() { config.C = orig }()
		config.Load()
		return config.C.SeedDemo
	}
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough-123456")

	// Seeding is opt-in in every environment. It used to default to on outside
	// production, so any deployment that forgot to set ENV silently grew a
	// demo@lyftr.local account with a publicly documented password.
	if load("development", "") {
		t.Error("development default: want SeedDemo=false")
	}
	if load("production", "") {
		t.Error("production default: want SeedDemo=false")
	}
	if !load("development", "true") {
		t.Error("development + SEED_DEMO=true: want SeedDemo=true")
	}
	if !load("production", "true") {
		t.Error("production + SEED_DEMO=true: want SeedDemo=true")
	}
	if load("development", "false") {
		t.Error("development + SEED_DEMO=false: want SeedDemo=false")
	}
}

// TestJWTSecretHardening covers the signing-key guard, which previously only
// rejected one exact literal and only when ENV was spelled "production".
func TestJWTSecretHardening(t *testing.T) {
	weak := []string{
		"",
		"short",
		"change-me-in-production-min-32-chars!!",
		"change-me-to-a-random-32-plus-character-string",
	}
	for _, s := range weak {
		if !config.WeakJWTSecret(s) {
			t.Errorf("WeakJWTSecret(%q) = false, want true", s)
		}
	}
	if config.WeakJWTSecret("a-genuinely-random-secret-of-sufficient-length") {
		t.Error("WeakJWTSecret rejected a strong secret")
	}

	// Outside production a weak/absent secret is replaced with a random one
	// rather than a known default, so tokens are never forgeable.
	t.Setenv("ENV", "development")
	t.Setenv("JWT_SECRET", "")
	orig := config.C
	t.Cleanup(func() { config.C = orig })
	config.Load()
	if config.WeakJWTSecret(config.C.JWTSecret) {
		t.Fatalf("development fallback produced a weak secret: %q", config.C.JWTSecret)
	}

	first := config.C.JWTSecret
	config.Load()
	if config.C.JWTSecret == first {
		t.Error("ephemeral secret was stable across loads; it should be random per process")
	}
}

// TestRegistrationClosedByDefault: an open signup endpoint is pure attack
// surface on a self-hosted instance, and its 409-vs-201 split is an
// email-enumeration oracle.
func TestRegistrationClosedByDefault(t *testing.T) {
	setupTestDB(t)
	config.C.AllowRegistration = false

	// A brand-new instance with no accounts must still be able to create its
	// first user, or closed-by-default would lock a fresh deployment out.
	c, w := newContext(0, http.MethodPost, "/api/v1/auth/register",
		map[string]string{"email": "first@example.com", "password": "password123"})
	th.Register(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("first user on an empty instance: got %d, want 201 (%s)", w.Code, w.Body.String())
	}

	// Once an account exists the window closes.
	c, w = newContext(0, http.MethodPost, "/api/v1/auth/register",
		map[string]string{"email": "second@example.com", "password": "password123"})
	th.Register(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("second user while closed: got %d, want 403 (%s)", w.Code, w.Body.String())
	}

	// Closed means closed even for an email that already exists — no oracle.
	c, w = newContext(0, http.MethodPost, "/api/v1/auth/register",
		map[string]string{"email": "first@example.com", "password": "password123"})
	th.Register(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("existing email while closed: got %d, want 403", w.Code)
	}
}

func TestRegistrationInviteCode(t *testing.T) {
	setupTestDB(t)
	config.C.RegistrationInviteCode = []byte("let-me-in")

	c, w := newContext(0, http.MethodPost, "/api/v1/auth/register",
		map[string]string{"email": "a@example.com", "password": "password123"})
	th.Register(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("missing invite code: got %d, want 403", w.Code)
	}

	c, w = newContext(0, http.MethodPost, "/api/v1/auth/register",
		map[string]string{"email": "a@example.com", "password": "password123", "invite_code": "wrong"})
	th.Register(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("wrong invite code: got %d, want 403", w.Code)
	}

	c, w = newContext(0, http.MethodPost, "/api/v1/auth/register",
		map[string]string{"email": "a@example.com", "password": "password123", "invite_code": "let-me-in"})
	th.Register(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("correct invite code: got %d, want 201 (%s)", w.Code, w.Body.String())
	}
}

// ─── Token revocation ──────────────────────────────────────────────────────
//
// Before this, access and refresh tokens were stateless JWTs with no jti and no
// denial list: a stolen token stayed valid for its full lifetime, there was no
// logout endpoint and no password-change endpoint, and the only remedy was
// rotating JWT_SECRET — which signs out every user on the instance.

// registerUser creates a real account through the handler so the returned
// tokens carry genuine jti/tv claims.
func registerUser(t *testing.T, email, password string) (uid int64, access, refresh string) {
	t.Helper()
	c, w := newContext(0, http.MethodPost, "/api/v1/auth/register",
		map[string]string{"email": email, "password": password})
	th.Register(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("register: got %d, want 201 (%s)", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	user := data["user"].(map[string]any)
	return int64(user["id"].(float64)), data["token"].(string), data["refresh_token"].(string)
}

// authedContext builds a request carrying a real bearer token, for the handlers
// that read the Authorization header directly (Logout).
func authedContext(uid int64, access, method, path string, body any) (*gin.Context, *httptest.ResponseRecorder) {
	c, w := newContext(uid, method, path, body)
	c.Request.Header.Set("Authorization", "Bearer "+access)
	return c, w
}

func TestLogoutRevokesTokens(t *testing.T) {
	setupTestDB(t)
	uid, access, refresh := registerUser(t, "logout@example.com", "password123")

	accessClaims, err := utils.ValidateToken(access)
	if err != nil {
		t.Fatalf("parse access token: %v", err)
	}
	if accessClaims.ID == "" {
		t.Fatal("access token has no jti — it could never be revoked individually")
	}

	// Valid before logout.
	if !middleware.TokenStillValid(stores.New(db.DB), accessClaims) {
		t.Fatal("token rejected before logout")
	}

	c, w := authedContext(uid, access, http.MethodPost, "/api/v1/auth/logout",
		map[string]string{"refresh_token": refresh})
	th.Logout(c)
	if w.Code != http.StatusOK {
		t.Fatalf("logout: got %d, want 200 (%s)", w.Code, w.Body.String())
	}

	// The access token is dead even though its signature and expiry are fine.
	if middleware.TokenStillValid(stores.New(db.DB), accessClaims) {
		t.Error("access token still valid after logout")
	}

	// And the refresh token can no longer mint a new pair.
	c, w = newContext(0, http.MethodPost, "/api/v1/auth/refresh",
		map[string]string{"refresh_token": refresh})
	th.RefreshToken(c)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("refresh after logout: got %d, want 401 (%s)", w.Code, w.Body.String())
	}
}

func TestRefreshTokenRotationDetectsReplay(t *testing.T) {
	setupTestDB(t)
	_, _, refresh := registerUser(t, "rotate@example.com", "password123")

	c, w := newContext(0, http.MethodPost, "/api/v1/auth/refresh",
		map[string]string{"refresh_token": refresh})
	th.RefreshToken(c)
	if w.Code != http.StatusOK {
		t.Fatalf("first refresh: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	rotated := decodeResponse(t, w)["data"].(map[string]any)["refresh_token"].(string)
	if rotated == refresh {
		t.Fatal("refresh did not rotate the token")
	}

	// Replaying the spent token fails — which is also the signal it leaked.
	c, w = newContext(0, http.MethodPost, "/api/v1/auth/refresh",
		map[string]string{"refresh_token": refresh})
	th.RefreshToken(c)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("replayed refresh token: got %d, want 401 (%s)", w.Code, w.Body.String())
	}

	// The rotated one still works.
	c, w = newContext(0, http.MethodPost, "/api/v1/auth/refresh",
		map[string]string{"refresh_token": rotated})
	th.RefreshToken(c)
	if w.Code != http.StatusOK {
		t.Errorf("rotated refresh token: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
}

func TestChangePasswordInvalidatesAllSessions(t *testing.T) {
	setupTestDB(t)
	uid, access, refresh := registerUser(t, "pw@example.com", "password123")

	// A second, independent session — a phone, say. It must die too.
	c, w := newContext(0, http.MethodPost, "/api/v1/auth/login",
		map[string]string{"email": "pw@example.com", "password": "password123"})
	th.Login(c)
	if w.Code != http.StatusOK {
		t.Fatalf("second login: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	otherAccess := decodeResponse(t, w)["data"].(map[string]any)["token"].(string)

	// Wrong current password is refused.
	c, w = newContext(uid, http.MethodPut, "/api/v1/me/password",
		map[string]string{"current_password": "not-it", "new_password": "brand-new-password"})
	th.ChangePassword(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong current password: got %d, want 401", w.Code)
	}

	c, w = newContext(uid, http.MethodPut, "/api/v1/me/password",
		map[string]string{"current_password": "password123", "new_password": "brand-new-password"})
	th.ChangePassword(c)
	if w.Code != http.StatusOK {
		t.Fatalf("change password: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	fresh := decodeResponse(t, w)["data"].(map[string]any)["token"].(string)

	s := stores.New(db.DB)
	for name, tok := range map[string]string{"original access": access, "other device": otherAccess} {
		claims, err := utils.ValidateToken(tok)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		if middleware.TokenStillValid(s, claims) {
			t.Errorf("%s token survived the password change", name)
		}
	}

	// The old refresh token can't be used to climb back in either.
	c, w = newContext(0, http.MethodPost, "/api/v1/auth/refresh",
		map[string]string{"refresh_token": refresh})
	th.RefreshToken(c)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("refresh after password change: got %d, want 401", w.Code)
	}

	// The caller isn't logged out of the session they changed it from.
	freshClaims, err := utils.ValidateToken(fresh)
	if err != nil {
		t.Fatalf("parse fresh token: %v", err)
	}
	if !middleware.TokenStillValid(s, freshClaims) {
		t.Error("the replacement token handed back by ChangePassword is not valid")
	}

	// The new password works; the old one doesn't.
	c, w = newContext(0, http.MethodPost, "/api/v1/auth/login",
		map[string]string{"email": "pw@example.com", "password": "password123"})
	th.Login(c)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("login with old password: got %d, want 401", w.Code)
	}
}

// TestPreRevocationTokensAreRejected: tokens minted before this feature existed
// carry no jti, so they can never be revoked. Honouring them would leave a
// population of permanently unrevocable credentials in circulation, so an
// upgrade invalidates them instead.
func TestPreRevocationTokensAreRejected(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	legacy := &utils.Claims{UserID: uid, Email: "test@example.com", Type: "access"}
	if middleware.TokenStillValid(stores.New(db.DB), legacy) {
		t.Error("a token with no jti was accepted")
	}
}

func TestDeleteAccountKillsTokens(t *testing.T) {
	setupTestDB(t)
	uid, access, _ := registerUser(t, "gone@example.com", "password123")
	claims, err := utils.ValidateToken(access)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}

	c, w := newContext(uid, http.MethodDelete, "/api/v1/me", nil)
	th.DeleteAccount(c)
	if w.Code != http.StatusOK {
		t.Fatalf("delete account: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if middleware.TokenStillValid(stores.New(db.DB), claims) {
		t.Error("token still valid after the account was deleted")
	}
}

func TestPurgeExpiredRevocations(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	s := stores.New(db.DB)

	if err := s.Token.RevokeJWT("expired-jti", uid, time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("revoke expired: %v", err)
	}
	if err := s.Token.RevokeJWT("live-jti", uid, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("revoke live: %v", err)
	}

	n, err := s.Token.PurgeExpiredRevocations()
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if n != 1 {
		t.Errorf("purged %d rows, want 1", n)
	}
	// The still-live denial must survive, or purging would resurrect a
	// logged-out token.
	if revoked, _ := s.Token.IsJWTRevoked("live-jti"); !revoked {
		t.Error("purge removed a denial for a token that has not expired yet")
	}
}
