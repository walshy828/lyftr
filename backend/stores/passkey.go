package stores

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/go-webauthn/webauthn/webauthn"
)

// PasskeyStore owns all SQL for webauthn_credentials.
type PasskeyStore struct{ db *sql.DB }

func NewPasskeyStore(db *sql.DB) *PasskeyStore { return &PasskeyStore{db: db} }

// credIDKey renders a raw credential ID as text for storage and lookup.
// base64url (unpadded) because that is the form the browser sends and the
// library expects, so nothing has to be re-encoded at the boundary.
func credIDKey(raw []byte) string {
	return base64.RawURLEncoding.EncodeToString(raw)
}

// Create stores a freshly registered credential. A duplicate credential_id
// surfaces as a UNIQUE violation, which is the authenticator re-enrolling a key
// the account already has.
func (s *PasskeyStore) Create(userID int64, userHandle []byte, name string, cred *webauthn.Credential) error {
	blob, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO webauthn_credentials (user_id, credential_id, user_handle, name, credential) VALUES (?, ?, ?, ?, ?)`,
		userID, credIDKey(cred.ID), credIDKey(userHandle), name, string(blob),
	)
	return err
}

// CredentialsFor returns every credential the user holds, in the library's own
// shape. Malformed rows are skipped rather than failing the whole login — one
// unreadable credential must not lock the account out of the others.
func (s *PasskeyStore) CredentialsFor(userID int64) ([]webauthn.Credential, error) {
	rows, err := s.db.Query(`SELECT credential FROM webauthn_credentials WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]webauthn.Credential, 0)
	for rows.Next() {
		var blob string
		if err := rows.Scan(&blob); err != nil {
			return nil, err
		}
		var cred webauthn.Credential
		if err := json.Unmarshal([]byte(blob), &cred); err != nil {
			continue
		}
		out = append(out, cred)
	}
	return out, rows.Err()
}

// UserByHandle resolves the account a discoverable (usernameless) login belongs
// to. The user handle is the only identifier such a login carries.
func (s *PasskeyStore) UserByHandle(userHandle []byte) (int64, error) {
	var uid int64
	err := s.db.QueryRow(
		`SELECT user_id FROM webauthn_credentials WHERE user_handle = ? LIMIT 1`,
		credIDKey(userHandle),
	).Scan(&uid)
	return uid, err
}

// HandleFor returns the user handle already issued to this account, or
// sql.ErrNoRows if it has no passkeys yet. Every credential on an account must
// share one handle — a second handle would make the account look like two
// different users to the authenticator, and its passkeys would stop
// recognising each other.
func (s *PasskeyStore) HandleFor(userID int64) ([]byte, error) {
	var handle string
	if err := s.db.QueryRow(
		`SELECT user_handle FROM webauthn_credentials WHERE user_id = ? LIMIT 1`, userID,
	).Scan(&handle); err != nil {
		return nil, err
	}
	return base64.RawURLEncoding.DecodeString(handle)
}

// List returns the user's passkeys as the account screen shows them — metadata
// only, never the credential blob.
func (s *PasskeyStore) List(userID int64) ([]models.Passkey, error) {
	rows, err := s.db.Query(
		`SELECT id, name, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Passkey, 0)
	for rows.Next() {
		var p models.Passkey
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpdateAfterLogin persists the credential's post-authentication state — most
// importantly the signature counter, which is how a cloned authenticator is
// detected — and records the use.
func (s *PasskeyStore) UpdateAfterLogin(cred *webauthn.Credential) error {
	blob, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`UPDATE webauthn_credentials SET credential = ?, last_used_at = ? WHERE credential_id = ?`,
		string(blob), time.Now().UTC(), credIDKey(cred.ID),
	)
	return err
}

// Delete removes one of the user's passkeys. Scoped by user_id so a guessed id
// can't strip credentials from another account; sql.ErrNoRows when nothing
// matched, so the controller can answer 404.
func (s *PasskeyStore) Delete(id, userID int64) error {
	res, err := s.db.Exec(`DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
