package controllers

import (
	"crypto/rand"

	"github.com/go-webauthn/webauthn/webauthn"
)

// waUser adapts a Lyftr account to the interface the WebAuthn library expects.
//
// Credentials are loaded eagerly rather than fetched lazily because the library
// calls WebAuthnCredentials() during a ceremony, where there is nowhere sane to
// surface a database error.
type waUser struct {
	handle      []byte
	name        string
	displayName string
	credentials []webauthn.Credential
}

// WebAuthnID is the opaque user handle. Deliberately NOT the database row id:
// the handle is stored inside the authenticator, often synced to a cloud
// keychain, so it must carry no meaning and must not be enumerable.
func (u waUser) WebAuthnID() []byte { return u.handle }

func (u waUser) WebAuthnName() string        { return u.name }
func (u waUser) WebAuthnDisplayName() string { return u.displayName }

func (u waUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

// newUserHandle mints the 64-byte random handle the spec recommends. Issued
// once per account on first enrolment and reused for every later passkey — a
// second handle would make the same account look like a different user to the
// authenticator, and its existing passkeys would stop being offered.
func newUserHandle() ([]byte, error) {
	handle := make([]byte, 64)
	if _, err := rand.Read(handle); err != nil {
		return nil, err
	}
	return handle, nil
}
