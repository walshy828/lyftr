package controllers

import (
	"net/http"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
)

// testPassword is the password every user in this file registers with.
const testPassword = "correct-horse-battery"

func claimsOf(t *testing.T, token string) *utils.Claims {
	t.Helper()
	claims, err := utils.ValidateToken(token)
	if err != nil {
		t.Fatalf("validate token: %v", err)
	}
	return claims
}

func login(t *testing.T, email string, remember bool) (access, refresh string, code int) {
	t.Helper()
	c, w := newContext(0, http.MethodPost, "/api/v1/auth/login",
		models.LoginRequest{Email: email, Password: testPassword, Remember: remember})
	th.Login(c)
	if w.Code != http.StatusOK {
		return "", "", w.Code
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	return data["token"].(string), data["refresh_token"].(string), w.Code
}

func doRefresh(t *testing.T, refresh string) (*utils.Claims, int) {
	t.Helper()
	c, w := newContext(0, http.MethodPost, "/api/v1/auth/refresh",
		models.RefreshRequest{RefreshToken: refresh})
	th.RefreshToken(c)
	if w.Code != http.StatusOK {
		return nil, w.Code
	}
	data := decodeResponse(t, w)["data"].(map[string]any)
	return claimsOf(t, data["refresh_token"].(string)), w.Code
}

// The whole point of the remember flag: an unremembered browser must get the
// short lifetime even though the account's stored preference is 30 days.
func TestLogin_rememberChoosesSessionLength(t *testing.T) {
	setupTestDB(t)
	registerUser(t, "sessions@example.com", testPassword)

	_, shortRefresh, _ := login(t, "sessions@example.com", false)
	_, longRefresh, _ := login(t, "sessions@example.com", true)

	short := claimsOf(t, shortRefresh)
	long := claimsOf(t, longRefresh)

	if got := time.Duration(short.SessionTTL) * time.Second; got != utils.RefreshTTL() {
		t.Fatalf("unremembered session: expected the short default %v, got %v", utils.RefreshTTL(), got)
	}
	if got := time.Duration(long.SessionTTL) * time.Second; got != 30*24*time.Hour {
		t.Fatalf("remembered session: expected 30 days, got %v", got)
	}
	if short.SessionID == long.SessionID {
		t.Fatal("each login must start its own device session")
	}
}

// Rotation mints the replacement from the presented token alone, so if the
// session claims didn't survive it, a 30-day session would silently become a
// 12-hour one on the very next refresh.
func TestRefresh_rotationPreservesSessionLifetime(t *testing.T) {
	setupTestDB(t)
	registerUser(t, "rotate@example.com", testPassword)
	_, refresh, _ := login(t, "rotate@example.com", true)
	original := claimsOf(t, refresh)

	rotated, code := doRefresh(t, refresh)
	if code != http.StatusOK {
		t.Fatalf("refresh: expected 200, got %d", code)
	}

	if rotated.SessionTTL != original.SessionTTL {
		t.Fatalf("session TTL changed on rotation: %d -> %d", original.SessionTTL, rotated.SessionTTL)
	}
	if rotated.SessionStart != original.SessionStart {
		t.Fatalf("session start changed on rotation: %d -> %d", original.SessionStart, rotated.SessionStart)
	}
	if rotated.SessionID != original.SessionID {
		t.Fatal("rotation must stay within the same device session")
	}
	if rotated.ID == original.ID {
		t.Fatal("rotation must still mint a new jti")
	}
}

// Sliding expiry: an active session's refresh window keeps moving out, so a
// device used regularly never has to sign in again.
func TestRefresh_slidesTheExpiryForward(t *testing.T) {
	setupTestDB(t)
	registerUser(t, "slide@example.com", testPassword)
	_, refresh, _ := login(t, "slide@example.com", true)
	original := claimsOf(t, refresh)

	time.Sleep(1100 * time.Millisecond) // exp has one-second resolution
	rotated, code := doRefresh(t, refresh)
	if code != http.StatusOK {
		t.Fatalf("refresh: expected 200, got %d", code)
	}
	if !rotated.ExpiresAt.After(original.ExpiresAt.Time) {
		t.Fatalf("expected the refresh window to slide forward, got %v then %v",
			original.ExpiresAt, rotated.ExpiresAt)
	}
}

// Sliding expiry alone would let one login last forever, so the chain's total
// age is capped regardless of how active it has been.
func TestRefresh_rejectsSessionPastTheAbsoluteCap(t *testing.T) {
	setupTestDB(t)
	uid, _, _ := registerUser(t, "ancient@example.com", testPassword)

	// A session that started well beyond the cap but whose token is still
	// individually unexpired — exactly what a long-lived device looks like
	// after months of daily rotation.
	old := utils.Session{
		ID:    utils.NewSessionID(),
		TTL:   30 * 24 * time.Hour,
		Start: time.Now().Add(-utils.AbsoluteSessionTTL() - time.Hour),
	}
	if err := th.s.DeviceSession.Create(old.ID, uid, "Old phone", "ua", true, time.Now().Add(old.TTL)); err != nil {
		t.Fatalf("seed session: %v", err)
	}
	_, refresh, err := utils.GenerateTokenPair(uid, "ancient@example.com", 0, old)
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	if _, code := doRefresh(t, refresh); code != http.StatusUnauthorized {
		t.Fatalf("expected 401 past the absolute cap, got %d", code)
	}
}

// Revoking a device has to actually stop it refreshing — otherwise "sign out
// this phone" is cosmetic.
func TestRefresh_rejectsRevokedDeviceSession(t *testing.T) {
	setupTestDB(t)
	uid, _, _ := registerUser(t, "revoked@example.com", testPassword)

	// Two devices on the same account: revoking one must not disturb the other.
	_, phone, _ := login(t, "revoked@example.com", true)
	_, laptop, _ := login(t, "revoked@example.com", true)
	phoneSID := claimsOf(t, phone).SessionID

	if err := th.s.DeviceSession.Revoke(phoneSID, uid); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	if _, code := doRefresh(t, phone); code != http.StatusUnauthorized {
		t.Fatalf("the revoked device must not refresh, got %d", code)
	}
	if _, code := doRefresh(t, laptop); code != http.StatusOK {
		t.Fatalf("the other device must be unaffected, got %d", code)
	}
}

// Upgrading the server must not sign everybody out: tokens minted before device
// sessions existed carry none of the new claims.
func TestRefresh_adoptsLegacyTokenWithoutSessionClaims(t *testing.T) {
	setupTestDB(t)
	uid, _, _ := registerUser(t, "legacy@example.com", testPassword)

	// utils.Session{} zero value == the claims a pre-upgrade token carries.
	_, refresh, err := utils.GenerateTokenPair(uid, "legacy@example.com", 0, utils.Session{TTL: time.Hour})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if claimsOf(t, refresh).SessionID != "" {
		t.Fatal("test setup: the legacy token should have no session id")
	}

	rotated, code := doRefresh(t, refresh)
	if code != http.StatusOK {
		t.Fatalf("a legacy token must still refresh, got %d", code)
	}
	if rotated.SessionID == "" {
		t.Fatal("refresh should have adopted the legacy token into a device session")
	}

	sessions, err := th.s.DeviceSession.List(uid)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var found bool
	for _, s := range sessions {
		if s.ID == rotated.SessionID {
			found = true
		}
	}
	if !found {
		t.Fatal("the adopted session should appear in the device list")
	}
}

func TestListSessions_scopedToUserAndMarksCurrent(t *testing.T) {
	setupTestDB(t)
	uid, _, _ := registerUser(t, "list@example.com", testPassword)
	_, refresh, _ := login(t, "list@example.com", true)
	sid := claimsOf(t, refresh).SessionID

	otherUID := createOtherTestUser(t)
	if err := th.s.DeviceSession.Create(utils.NewSessionID(), otherUID, "Not mine", "ua", true, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("seed other: %v", err)
	}

	c, w := newContext(uid, http.MethodGet, "/api/v1/sessions", nil)
	c.Set("session_id", sid)
	th.ListSessions(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	list := decodeResponse(t, w)["data"].([]any)
	var current int
	for _, raw := range list {
		s := raw.(map[string]any)
		if s["label"] == "Not mine" {
			t.Fatal("another user's session leaked into the list")
		}
		if s["current"] == true {
			current++
			if s["id"] != sid {
				t.Fatalf("wrong session marked current: %v", s["id"])
			}
		}
	}
	if current != 1 {
		t.Fatalf("expected exactly one current session, got %d", current)
	}
}

func TestRevokeSession_cannotTouchAnotherUsersDevice(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	otherUID := createOtherTestUser(t)

	victim := utils.NewSessionID()
	if err := th.s.DeviceSession.Create(victim, otherUID, "Victim", "ua", true, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("seed: %v", err)
	}

	c, w := newContext(uid, http.MethodDelete, "/api/v1/sessions/"+victim, nil)
	setParam(c, "id", victim)
	th.RevokeSession(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
	live, err := th.s.DeviceSession.IsLive(victim, otherUID)
	if err != nil || !live {
		t.Fatal("the other user's session must survive")
	}
}

// A PAT is a machine credential; it must not be able to enumerate or sign out
// the interactive sessions of the account it belongs to.
func TestSessions_rejectPATCallers(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	c, w := newContext(uid, http.MethodGet, "/api/v1/sessions", nil)
	c.Set("auth_method", "pat")
	th.ListSessions(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("list: expected 403, got %d", w.Code)
	}

	c, w = newContext(uid, http.MethodDelete, "/api/v1/sessions/x", nil)
	c.Set("auth_method", "pat")
	setParam(c, "id", "x")
	th.RevokeSession(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("revoke: expected 403, got %d", w.Code)
	}
}

// Long sessions must not weaken the existing kill switch.
func TestChangePassword_killsRememberedSessionsOnOtherDevices(t *testing.T) {
	setupTestDB(t)
	registerUser(t, "pw@example.com", testPassword)

	// Set a real password hash so ChangePassword's verification can pass.
	hash, err := utils.HashPassword(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if _, err := db.DB.Exec(`UPDATE users SET password_hash = ? WHERE email = ?`, hash, "pw@example.com"); err != nil {
		t.Fatalf("seed hash: %v", err)
	}

	_, phoneRefresh, _ := login(t, "pw@example.com", true)
	uid := claimsOf(t, phoneRefresh).UserID

	c, w := newContext(uid, http.MethodPut, "/api/v1/me/password",
		models.ChangePasswordRequest{CurrentPassword: testPassword, NewPassword: "an-entirely-new-one"})
	th.ChangePassword(c)
	if w.Code != http.StatusOK {
		t.Fatalf("change password: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if _, code := doRefresh(t, phoneRefresh); code != http.StatusUnauthorized {
		t.Fatalf("the other device's remembered session must be dead, got %d", code)
	}

	// The device that changed the password keeps working, and is the only one
	// left on the account screen.
	data := decodeResponse(t, w)["data"].(map[string]any)
	if _, code := doRefresh(t, data["refresh_token"].(string)); code != http.StatusOK {
		t.Fatalf("the current device should keep its session, got %d", code)
	}
}

func TestUpdateSettings_rejectsSessionLengthAboveTheServerCeiling(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	over := config.MaxSessionDays() + 1
	c, w := newContext(uid, http.MethodPut, "/api/v1/settings", models.UpdateSettingsRequest{SessionMaxDays: &over})
	th.UpdateSettings(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 above the ceiling, got %d: %s", w.Code, w.Body.String())
	}

	ok := config.MaxSessionDays()
	c, w = newContext(uid, http.MethodPut, "/api/v1/settings", models.UpdateSettingsRequest{SessionMaxDays: &ok})
	th.UpdateSettings(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected the ceiling itself to be accepted, got %d: %s", w.Code, w.Body.String())
	}
	if got := decodeResponse(t, w)["data"].(map[string]any)["session_max_days"].(float64); int(got) != ok {
		t.Fatalf("expected %d days to persist, got %v", ok, got)
	}
}

// A stored preference must not outlive a ceiling the operator lowers later.
func TestRememberTTL_clampsToTheConfiguredCeiling(t *testing.T) {
	setupTestConfig(t)
	config.C.MaxSessionDaysRaw = "7"

	if got := utils.RememberTTL(365); got != 7*24*time.Hour {
		t.Fatalf("expected the 7-day ceiling to win, got %v", got)
	}
	if got := utils.RememberTTL(3); got != 3*24*time.Hour {
		t.Fatalf("expected a value under the ceiling to be honoured, got %v", got)
	}

	// 0 means "unset", not "expire immediately".
	config.C.MaxSessionDaysRaw = ""
	if got := utils.RememberTTL(0); got != config.DefaultSessionDays*24*time.Hour {
		t.Fatalf("expected the default for an unset preference, got %v", got)
	}
}
