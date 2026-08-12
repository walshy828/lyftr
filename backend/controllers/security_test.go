package controllers

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/middleware"
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
