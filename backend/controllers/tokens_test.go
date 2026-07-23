package controllers

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/models"
)

func createOtherTestUser(t *testing.T) int64 {
	t.Helper()
	res, err := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "other@example.com", "hashed")
	if err != nil {
		t.Fatalf("create other test user: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func TestCreateToken_returnsPlaintextOnce(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPost, "/api/v1/tokens", models.CreateTokenRequest{Name: "MCP server"})
	th.CreateToken(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	data := resp["data"].(map[string]any)
	value, _ := data["value"].(string)
	if value == "" || value[:10] != "lyftr_pat_" {
		t.Fatalf("expected plaintext value with lyftr_pat_ prefix, got %q", value)
	}
	token := data["token"].(map[string]any)
	if token["name"] != "MCP server" {
		t.Fatalf("expected name to round-trip, got %v", token["name"])
	}
	if _, hasHash := token["token_hash"]; hasHash {
		t.Fatalf("token metadata must never include the hash")
	}
}

func TestListTokens_scopedByUserAndExcludesRevoked(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	otherUID := createOtherTestUser(t)

	c, _ := newContext(uid, http.MethodPost, "/api/v1/tokens", models.CreateTokenRequest{Name: "keep"})
	th.CreateToken(c)
	c, w := newContext(uid, http.MethodPost, "/api/v1/tokens", models.CreateTokenRequest{Name: "revoke-me"})
	th.CreateToken(c)
	revokeID := decodeResponse(t, w)["data"].(map[string]any)["token"].(map[string]any)["id"].(float64)

	c, _ = newContext(otherUID, http.MethodPost, "/api/v1/tokens", models.CreateTokenRequest{Name: "not mine"})
	th.CreateToken(c)

	c, w = newContext(uid, http.MethodDelete, "/api/v1/tokens/1", nil)
	setParam(c, "id", strconv.FormatInt(int64(revokeID), 10))
	th.RevokeToken(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected revoke 200, got %d: %s", w.Code, w.Body.String())
	}

	c, w = newContext(uid, http.MethodGet, "/api/v1/tokens", nil)
	th.ListTokens(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected 1 active token (own, non-revoked), got %d", len(data))
	}
	if data[0].(map[string]any)["name"] != "keep" {
		t.Fatalf("expected the non-revoked token, got %v", data[0])
	}
}

func TestRevokeToken_wrongOwnerNotFound(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	otherUID := createOtherTestUser(t)

	c, w := newContext(otherUID, http.MethodPost, "/api/v1/tokens", models.CreateTokenRequest{Name: "theirs"})
	th.CreateToken(c)
	id := decodeResponse(t, w)["data"].(map[string]any)["token"].(map[string]any)["id"].(float64)

	c, w = newContext(uid, http.MethodDelete, "/api/v1/tokens/1", nil)
	setParam(c, "id", strconv.FormatInt(int64(id), 10))
	th.RevokeToken(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 revoking another user's token, got %d", w.Code)
	}
}

// PAT-authenticated callers must never manage tokens themselves.
func TestTokenEndpoints_rejectPATAuth(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodGet, "/api/v1/tokens", nil)
	c.Set("auth_method", "pat")
	th.ListTokens(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for PAT-authenticated ListTokens, got %d", w.Code)
	}

	c, w = newContext(uid, http.MethodPost, "/api/v1/tokens", models.CreateTokenRequest{Name: "x"})
	c.Set("auth_method", "pat")
	th.CreateToken(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for PAT-authenticated CreateToken, got %d", w.Code)
	}
}
