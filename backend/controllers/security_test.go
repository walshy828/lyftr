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

	if !load("development", "") {
		t.Error("development default: want SeedDemo=true")
	}
	if load("production", "") {
		t.Error("production default: want SeedDemo=false")
	}
	if !load("production", "true") {
		t.Error("production + SEED_DEMO=true: want SeedDemo=true")
	}
	if load("development", "false") {
		t.Error("development + SEED_DEMO=false: want SeedDemo=false")
	}
}
