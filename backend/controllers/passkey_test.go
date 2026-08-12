package controllers

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/webauthn"
)

// enablePasskeys points the test config at a Relying Party. Note that a full
// ceremony can't be driven from here — that needs a real authenticator — so
// these tests cover the parts around it: config gating, auth rules, and the
// storage scoping that decides whose credentials are whose.
func enablePasskeys(t *testing.T) {
	t.Helper()
	config.C.WebAuthnRPID = "lyftr.example.com"
	config.C.WebAuthnRPName = "Lyftr"
	config.C.WebAuthnRPOrigins = []string{"https://lyftr.example.com"}
}

func TestPasskeyEndpoints_serviceUnavailableWhenNotConfigured(t *testing.T) {
	setupTestDB(t) // leaves WebAuthnRPID empty
	uid := createTestUser(t)

	cases := []struct {
		name string
		call func(*gin.Context)
	}{
		{"register begin", th.BeginPasskeyRegistration},
		{"register finish", th.FinishPasskeyRegistration},
		{"login begin", th.BeginPasskeyLogin},
		{"login finish", th.FinishPasskeyLogin},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, http.MethodPost, "/api/v1/passkeys", nil)
			tc.call(c)
			// 503, not 4xx: an unconfigured Relying Party is an operator
			// problem, not something the caller did wrong.
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected 503, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

// A PAT must not be able to attach a new way of signing in to the account it
// belongs to — that would let a leaked token outlive its own revocation.
func TestPasskeyManagement_rejectsPATCallers(t *testing.T) {
	setupTestDB(t)
	enablePasskeys(t)
	uid := createTestUser(t)

	for _, tc := range []struct {
		name string
		call func(*gin.Context)
	}{
		{"list", th.ListPasskeys},
		{"delete", func(c *gin.Context) { setParam(c, "id", "1"); th.DeletePasskey(c) }},
		{"register begin", th.BeginPasskeyRegistration},
		{"register finish", th.FinishPasskeyRegistration},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, w := newContext(uid, http.MethodPost, "/api/v1/passkeys", nil)
			c.Set("auth_method", "pat")
			tc.call(c)
			if w.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestFinishPasskeyRegistration_requiresAChallengeInFlight(t *testing.T) {
	setupTestDB(t)
	enablePasskeys(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodPost, "/api/v1/passkeys/register/finish", nil)
	th.FinishPasskeyRegistration(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without a registration in progress, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFinishPasskeyLogin_rejectsAnUnknownChallenge(t *testing.T) {
	setupTestDB(t)
	enablePasskeys(t)

	c, w := newContext(0, http.MethodPost, "/api/v1/auth/webauthn/login/finish?challenge_id=made-up", nil)
	th.FinishPasskeyLogin(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for an unknown challenge, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── credential storage ─────────────────────────────────────────────────────

func seedCredential(t *testing.T, uid int64, handle []byte, credID, name string) {
	t.Helper()
	cred := &webauthn.Credential{ID: []byte(credID), PublicKey: []byte("pk")}
	if err := th.s.Passkey.Create(uid, handle, name, cred); err != nil {
		t.Fatalf("seed credential: %v", err)
	}
}

func TestPasskeyStore_listAndDeleteAreScopedToTheOwner(t *testing.T) {
	setupTestDB(t)
	enablePasskeys(t)
	uid := createTestUser(t)
	otherUID := createOtherTestUser(t)

	seedCredential(t, uid, []byte("handle-a"), "cred-mine", "iPhone")
	seedCredential(t, otherUID, []byte("handle-b"), "cred-theirs", "Their key")

	c, w := newContext(uid, http.MethodGet, "/api/v1/passkeys", nil)
	th.ListPasskeys(c)
	if w.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", w.Code)
	}
	list := decodeResponse(t, w)["data"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["name"] != "iPhone" {
		t.Fatalf("expected only the caller's passkey, got %v", list)
	}
	victimID := int64(list[0].(map[string]any)["id"].(float64))

	// Deleting somebody else's is a 404, not a silent success.
	theirs, err := th.s.Passkey.List(otherUID)
	if err != nil || len(theirs) != 1 {
		t.Fatalf("seed check: %v %v", theirs, err)
	}
	c, w = newContext(uid, http.MethodDelete, "/api/v1/passkeys", nil)
	setParam(c, "id", strconv.FormatInt(theirs[0].ID, 10))
	th.DeletePasskey(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 deleting another user's passkey, got %d", w.Code)
	}
	if still, _ := th.s.Passkey.List(otherUID); len(still) != 1 {
		t.Fatal("the other user's passkey must survive")
	}

	// Deleting your own works.
	c, w = newContext(uid, http.MethodDelete, "/api/v1/passkeys", nil)
	setParam(c, "id", strconv.FormatInt(victimID, 10))
	th.DeletePasskey(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 deleting own passkey, got %d", w.Code)
	}
	if mine, _ := th.s.Passkey.List(uid); len(mine) != 0 {
		t.Fatal("the passkey should be gone")
	}
}

// Every passkey on an account must share one handle — a second would make the
// account look like a different user to the authenticator, and its existing
// passkeys would stop being offered.
func TestPasskeyStore_handleIsStableAcrossCredentials(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	handle := []byte("stable-handle")

	seedCredential(t, uid, handle, "cred-1", "First")
	got, err := th.s.Passkey.HandleFor(uid)
	if err != nil {
		t.Fatalf("handle: %v", err)
	}
	if string(got) != string(handle) {
		t.Fatalf("handle round-trip failed: %q", got)
	}

	seedCredential(t, uid, handle, "cred-2", "Second")
	resolved, err := th.s.Passkey.UserByHandle(handle)
	if err != nil || resolved != uid {
		t.Fatalf("expected the handle to resolve to user %d, got %d (%v)", uid, resolved, err)
	}

	creds, err := th.s.Passkey.CredentialsFor(uid)
	if err != nil || len(creds) != 2 {
		t.Fatalf("expected both credentials, got %d (%v)", len(creds), err)
	}
}

func TestPasskeyStore_rejectsDuplicateCredentialID(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	seedCredential(t, uid, []byte("h"), "same-id", "First")

	cred := &webauthn.Credential{ID: []byte("same-id"), PublicKey: []byte("pk")}
	if err := th.s.Passkey.Create(uid, []byte("h"), "Again", cred); err == nil {
		t.Fatal("expected a unique violation re-registering the same credential")
	}
}

// A cloned authenticator shows up as the signature counter going backwards, so
// the counter has to actually be persisted between logins.
func TestPasskeyStore_persistsTheSignatureCounter(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	seedCredential(t, uid, []byte("h"), "counter-cred", "Key")

	cred := &webauthn.Credential{ID: []byte("counter-cred"), PublicKey: []byte("pk")}
	cred.Authenticator.SignCount = 42
	if err := th.s.Passkey.UpdateAfterLogin(cred); err != nil {
		t.Fatalf("update: %v", err)
	}

	creds, err := th.s.Passkey.CredentialsFor(uid)
	if err != nil || len(creds) != 1 {
		t.Fatalf("reload: %d (%v)", len(creds), err)
	}
	if creds[0].Authenticator.SignCount != 42 {
		t.Fatalf("expected the counter to persist, got %d", creds[0].Authenticator.SignCount)
	}

	list, _ := th.s.Passkey.List(uid)
	if list[0].LastUsedAt == nil {
		t.Fatal("expected last_used_at to be recorded")
	}
}
