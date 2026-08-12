// Package passkey wraps the WebAuthn library with the two pieces of state a
// ceremony needs that the library deliberately leaves to the application: the
// configured Relying Party, and somewhere to park the challenge between the
// "begin" and "finish" halves of a registration or login.
package passkey

import (
	"errors"
	"sync"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/go-webauthn/webauthn/webauthn"
)

var (
	once     sync.Once
	instance *webauthn.WebAuthn
	initErr  error
)

// ErrDisabled is returned when passkeys aren't configured on this server.
var ErrDisabled = errors.New("passkeys are not enabled on this server")

// Enabled reports whether the operator has configured a Relying Party ID.
// Passkeys are off by default: the RP ID cannot be inferred from a request
// (that would let a caller choose it), and a wrong value doesn't fail loudly —
// it silently makes every enrolled credential unusable.
func Enabled() bool { return config.C != nil && config.C.WebAuthnRPID != "" }

// Instance returns the shared Relying Party, building it on first use.
// Memoised because the config is fixed for the process lifetime.
func Instance() (*webauthn.WebAuthn, error) {
	if !Enabled() {
		return nil, ErrDisabled
	}
	once.Do(func() {
		instance, initErr = webauthn.New(&webauthn.Config{
			RPID:          config.C.WebAuthnRPID,
			RPDisplayName: config.C.WebAuthnRPName,
			RPOrigins:     config.C.WebAuthnRPOrigins,
		})
	})
	return instance, initErr
}

// ─── Challenge storage ──────────────────────────────────────────────────────

// challengeTTL is how long a half-finished ceremony stays resumable. Long
// enough to unlock a phone and pick a credential, short enough that an
// abandoned challenge isn't sitting around to be replayed.
// Var rather than const only so tests can shorten it.
var challengeTTL = 5 * time.Minute

type pending struct {
	data    *webauthn.SessionData
	expires time.Time
}

// In-memory rather than in SQLite on purpose: these live for seconds, are
// worthless after use, and a restart mid-ceremony should invalidate them
// anyway. Lyftr runs as a single process, so there is no instance to share
// them with — if that ever changes, this is the thing that has to move.
var (
	mu       sync.Mutex
	pendings = map[string]*pending{}
)

// PutChallenge stores session data under a caller-chosen key, replacing any
// challenge already held under it — starting a new ceremony must invalidate the
// one it supersedes rather than leaving two live at once.
func PutChallenge(key string, data *webauthn.SessionData) {
	mu.Lock()
	defer mu.Unlock()
	sweepLocked()
	pendings[key] = &pending{data: data, expires: time.Now().Add(challengeTTL)}
}

// TakeChallenge retrieves and consumes a stored challenge. Single-use by
// construction: a challenge that could be redeemed twice is a replay waiting to
// happen, so the delete is unconditional.
func TakeChallenge(key string) (*webauthn.SessionData, bool) {
	mu.Lock()
	defer mu.Unlock()
	p, ok := pendings[key]
	delete(pendings, key)
	if !ok || time.Now().After(p.expires) {
		return nil, false
	}
	return p.data, true
}

// sweepLocked drops expired entries so an abandoned-ceremony flood can't grow
// the map without bound. Cheap because the map only ever holds ceremonies from
// the last few minutes.
func sweepLocked() {
	now := time.Now()
	for k, p := range pendings {
		if now.After(p.expires) {
			delete(pendings, k)
		}
	}
}
