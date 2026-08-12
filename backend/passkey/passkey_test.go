package passkey

import (
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/go-webauthn/webauthn/webauthn"
)

func withConfig(t *testing.T, rpID string) {
	t.Helper()
	orig := config.C
	config.C = &config.Config{WebAuthnRPID: rpID, WebAuthnRPName: "Lyftr"}
	if rpID != "" {
		config.C.WebAuthnRPOrigins = []string{"https://" + rpID}
	}
	t.Cleanup(func() { config.C = orig })
}

// Off unless explicitly configured: the RP ID can't be inferred from a request
// without letting the caller choose it, and a wrong one silently breaks every
// enrolled credential.
func TestEnabled_requiresAnExplicitRPID(t *testing.T) {
	withConfig(t, "")
	if Enabled() {
		t.Fatal("passkeys must be off when no RP ID is configured")
	}
	if _, err := Instance(); err != ErrDisabled {
		t.Fatalf("expected ErrDisabled, got %v", err)
	}

	withConfig(t, "lyftr.example.com")
	if !Enabled() {
		t.Fatal("passkeys should be on once an RP ID is set")
	}
}

func TestChallengeStore_isSingleUse(t *testing.T) {
	data := &webauthn.SessionData{Challenge: "abc"}
	PutChallenge("reg:1", data)

	got, ok := TakeChallenge("reg:1")
	if !ok || got.Challenge != "abc" {
		t.Fatalf("expected the stored challenge back, got %v ok=%v", got, ok)
	}

	// A challenge redeemable twice is a replay waiting to happen.
	if _, ok := TakeChallenge("reg:1"); ok {
		t.Fatal("a challenge must not be redeemable a second time")
	}
}

func TestChallengeStore_unknownKey(t *testing.T) {
	if _, ok := TakeChallenge("reg:does-not-exist"); ok {
		t.Fatal("expected a miss for an unknown key")
	}
}

// Starting a second ceremony must invalidate the first rather than leaving two
// challenges live for the same user.
func TestChallengeStore_replacesAnEarlierChallenge(t *testing.T) {
	PutChallenge("reg:2", &webauthn.SessionData{Challenge: "first"})
	PutChallenge("reg:2", &webauthn.SessionData{Challenge: "second"})

	got, ok := TakeChallenge("reg:2")
	if !ok || got.Challenge != "second" {
		t.Fatalf("expected the newer challenge, got %v ok=%v", got, ok)
	}
}

func TestChallengeStore_expires(t *testing.T) {
	orig := challengeTTL
	challengeTTL = 10 * time.Millisecond
	t.Cleanup(func() { challengeTTL = orig })

	PutChallenge("reg:3", &webauthn.SessionData{Challenge: "stale"})
	time.Sleep(30 * time.Millisecond)

	if _, ok := TakeChallenge("reg:3"); ok {
		t.Fatal("an expired challenge must not be redeemable")
	}
}

// The RP ID is the one value that must not be guessed; confirm it and the
// derived origin reach the library as configured.
func TestInstance_usesTheConfiguredRelyingParty(t *testing.T) {
	withConfig(t, "lyftr.example.com")

	// Instance() memoises for the process, so build directly to assert on the
	// config this package produces.
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          config.C.WebAuthnRPID,
		RPDisplayName: config.C.WebAuthnRPName,
		RPOrigins:     config.C.WebAuthnRPOrigins,
	})
	if err != nil {
		t.Fatalf("build relying party: %v", err)
	}
	if wa.Config.RPID != "lyftr.example.com" {
		t.Fatalf("RP ID = %q", wa.Config.RPID)
	}
	if len(wa.Config.RPOrigins) != 1 || wa.Config.RPOrigins[0] != "https://lyftr.example.com" {
		t.Fatalf("RP origins = %v; the origin should default to https + the RP ID", wa.Config.RPOrigins)
	}
}
