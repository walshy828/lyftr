package controllers

import (
	"database/sql"
	"log"
	"strconv"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/passkey"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// relyingParty resolves the configured Relying Party, answering 503 when
// passkeys aren't set up. A misconfigured RP is an operator problem, not a
// caller error, so it is never reported as a 4xx.
func (h *Handler) relyingParty(c *gin.Context) (*webauthn.WebAuthn, bool) {
	wa, err := passkey.Instance()
	if err != nil {
		if err != passkey.ErrDisabled {
			log.Printf("[passkey] relying party: %v", err)
		}
		utils.ServiceUnavailable(c, "passkeys are not enabled on this server")
		return nil, false
	}
	return wa, true
}

// loadWAUser assembles the library's view of an account.
func (h *Handler) loadWAUser(uid int64, handle []byte) (waUser, error) {
	user, err := h.s.User.GetMe(uid)
	if err != nil {
		return waUser{}, err
	}
	creds, err := h.s.Passkey.CredentialsFor(uid)
	if err != nil {
		return waUser{}, err
	}
	display := user.Name
	if display == "" {
		display = user.Email
	}
	return waUser{handle: handle, name: user.Email, displayName: display, credentials: creds}, nil
}

// ─── Enrolment (authenticated) ──────────────────────────────────────────────

// BeginPasskeyRegistration starts enrolment for the logged-in user.
//
// JWT-only, like the other credential-management endpoints: a personal access
// token must not be able to attach a new way of signing in to the account it
// belongs to, which would let a leaked PAT outlive its own revocation.
func (h *Handler) BeginPasskeyRegistration(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	wa, ok := h.relyingParty(c)
	if !ok {
		return
	}
	uid := middleware.UserID(c)

	// Reuse the account's existing handle so every passkey on it belongs to the
	// same WebAuthn user; mint one only on the first enrolment.
	handle, err := h.s.Passkey.HandleFor(uid)
	if err == sql.ErrNoRows {
		if handle, err = newUserHandle(); err != nil {
			utils.InternalError(c)
			return
		}
	} else if utils.DBError(c, err) {
		return
	}

	user, err := h.loadWAUser(uid, handle)
	if utils.DBError(c, err) {
		return
	}

	creation, session, err := wa.BeginRegistration(user,
		// Exclude what's already enrolled so an authenticator offers to create a
		// new passkey rather than silently overwriting the one it holds.
		webauthn.WithExclusions(credentialDescriptors(user.credentials)),
		// Discoverable ("resident") is not optional here: sign-in is
		// usernameless, and a non-discoverable credential can't be found without
		// being told which account to look for. Without this the passkey
		// enrols happily and then is never offered at sign-in.
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey: protocol.ResidentKeyRequirementRequired,
			// The legacy boolean; still honoured by older authenticators.
			RequireResidentKey: &residentKeyRequired,
			// Preferred, not Required: this is the difference between "Face ID
			// prompts" and "sign-in is impossible on a device without
			// biometrics or a PIN".
			UserVerification: protocol.VerificationPreferred,
		}),
	)
	if err != nil {
		log.Printf("[passkey] begin registration: %v", err)
		utils.InternalError(c)
		return
	}

	// Keyed by user: a second enrolment attempt by the same account replaces the
	// first rather than leaving two challenges live.
	passkey.PutChallenge(registrationKey(uid), session)
	utils.OK(c, creation)
}

// FinishPasskeyRegistration verifies the authenticator's response and stores
// the credential.
func (h *Handler) FinishPasskeyRegistration(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	wa, ok := h.relyingParty(c)
	if !ok {
		return
	}
	uid := middleware.UserID(c)

	session, found := passkey.TakeChallenge(registrationKey(uid))
	if !found {
		utils.BadRequest(c, "no registration in progress, or it expired — start again")
		return
	}

	// The passkey's display name travels as a query parameter because the body
	// is the authenticator's response verbatim, which the library parses itself.
	name := c.Query("name")
	if len(name) > 100 {
		name = name[:100]
	}
	if name == "" {
		name = utils.DeviceLabel(c.GetHeader("User-Agent"))
	}

	user, err := h.loadWAUser(uid, session.UserID)
	if utils.DBError(c, err) {
		return
	}

	cred, err := wa.FinishRegistration(user, *session, c.Request)
	if err != nil {
		// The detail belongs in the log, not the response: it describes exactly
		// which check failed, which is a gift to anyone probing the endpoint.
		log.Printf("[passkey] finish registration for user %d: %v", uid, err)
		utils.BadRequest(c, "could not verify that passkey")
		return
	}

	if err := h.s.Passkey.Create(uid, session.UserID, name, cred); err != nil {
		if utils.IsUniqueViolation(err) {
			utils.Conflict(c, "that passkey is already registered")
			return
		}
		utils.DBError(c, err)
		return
	}
	utils.Created(c, gin.H{"registered": true, "name": name})
}

// ─── Sign-in (public) ───────────────────────────────────────────────────────

// BeginPasskeyLogin starts a usernameless sign-in.
//
// Discoverable by design: the browser offers whichever passkey matches, so the
// user never types an email. That also means this endpoint reveals nothing —
// there is no account to probe for, because none is named.
func (h *Handler) BeginPasskeyLogin(c *gin.Context) {
	wa, ok := h.relyingParty(c)
	if !ok {
		return
	}

	assertion, session, err := wa.BeginDiscoverableLogin(
		// Ask the authenticator to verify the human, which is what makes this
		// a Face ID / Touch ID / passcode prompt rather than a silent assertion.
		webauthn.WithUserVerification(protocol.VerificationPreferred),
	)
	if err != nil {
		log.Printf("[passkey] begin login: %v", err)
		utils.InternalError(c)
		return
	}

	// There is no user to key the challenge by yet, so the challenge itself is
	// the handle. It's random, single-use, and the client echoes it back. The
	// namespacing is applied server-side on both ends — handing the client the
	// internal key would let it aim at the registration namespace.
	passkey.PutChallenge(loginKey(session.Challenge), session)
	utils.OK(c, gin.H{"publicKey": assertion.Response, "challenge_id": session.Challenge})
}

// FinishPasskeyLogin verifies the assertion and issues a session, exactly as a
// password login would.
func (h *Handler) FinishPasskeyLogin(c *gin.Context) {
	wa, ok := h.relyingParty(c)
	if !ok {
		return
	}

	session, found := passkey.TakeChallenge(loginKey(c.Query("challenge_id")))
	if !found {
		utils.Unauthorized(c, "sign-in expired, please try again")
		return
	}

	// Resolves the account from the user handle the authenticator returns. The
	// library hands the resulting user back, so nothing here trusts a
	// caller-supplied identity.
	var uid int64
	lookup := func(rawID, userHandle []byte) (webauthn.User, error) {
		id, err := h.s.Passkey.UserByHandle(userHandle)
		if err != nil {
			return nil, err
		}
		uid = id
		return h.loadWAUser(id, userHandle)
	}

	_, cred, err := wa.FinishPasskeyLogin(lookup, *session, c.Request)
	if err != nil {
		log.Printf("[passkey] finish login: %v", err)
		utils.Unauthorized(c, "could not verify that passkey")
		return
	}

	// A cloned authenticator is the one thing a passkey can't rule out on its
	// own, and the counter going backwards is how it shows up. Refuse rather
	// than log: the alternative is knowingly signing in a possible clone.
	if cred.Authenticator.CloneWarning {
		log.Printf("[passkey] clone warning for user %d — refusing sign-in", uid)
		utils.Unauthorized(c, "could not verify that passkey")
		return
	}

	if err := h.s.Passkey.UpdateAfterLogin(cred); err != nil {
		// Best-effort: it advances the signature counter and the "last used"
		// display. Failing the sign-in over it would be worse than the drift.
		log.Printf("[passkey] update credential: %v", err)
	}

	user, err := h.s.User.GetByID(uid)
	if utils.DBError(c, err) {
		return
	}

	// A passkey is a stronger credential than a password and is bound to this
	// device already, so the session it establishes is a remembered one.
	access, refresh, err := h.startSession(c, user, true)
	if err != nil {
		utils.InternalError(c)
		return
	}
	utils.OK(c, models.AuthResponse{Token: access, RefreshToken: refresh, User: user})
}

// ─── Management (authenticated) ─────────────────────────────────────────────

func (h *Handler) ListPasskeys(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	keys, err := h.s.Passkey.List(middleware.UserID(c))
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, keys)
}

func (h *Handler) DeletePasskey(c *gin.Context) {
	if !requireJWT(c) {
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid passkey id")
		return
	}

	err = h.s.Passkey.Delete(id, middleware.UserID(c))
	if err == sql.ErrNoRows {
		utils.NotFound(c, "passkey not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}

// ─── helpers ────────────────────────────────────────────────────────────────

// residentKeyRequired backs the legacy RequireResidentKey pointer field.
var residentKeyRequired = true

// Namespaced so a registration challenge can never be redeemed by the login
// endpoint or the reverse.
func registrationKey(uid int64) string { return "reg:" + strconv.FormatInt(uid, 10) }
func loginKey(challenge string) string { return "login:" + challenge }

// credentialDescriptors lists what the account already has, so an authenticator
// offers to create a new passkey instead of silently replacing the one it holds.
func credentialDescriptors(creds []webauthn.Credential) []protocol.CredentialDescriptor {
	out := make([]protocol.CredentialDescriptor, 0, len(creds))
	for _, cred := range creds {
		out = append(out, cred.Descriptor())
	}
	return out
}
