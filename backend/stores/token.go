package stores

import (
	"database/sql"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// TokenStore owns all SQL for the personal_access_tokens entity.
type TokenStore struct{ db *sql.DB }

func NewTokenStore(db *sql.DB) *TokenStore { return &TokenStore{db: db} }

const tokenCols = `id, name, token_prefix, created_at, last_used_at, expires_at`

func (s *TokenStore) Create(userID int64, name, hash, prefix string, expiresAt *time.Time) (models.PersonalAccessToken, error) {
	res, err := s.db.Exec(
		`INSERT INTO personal_access_tokens (user_id, name, token_prefix, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)`,
		userID, name, prefix, hash, expiresAt,
	)
	if err != nil {
		return models.PersonalAccessToken{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return models.PersonalAccessToken{}, err
	}
	return s.get(id)
}

func (s *TokenStore) get(id int64) (models.PersonalAccessToken, error) {
	var t models.PersonalAccessToken
	err := s.db.QueryRow(`SELECT `+tokenCols+` FROM personal_access_tokens WHERE id = ?`, id).
		Scan(&t.ID, &t.Name, &t.TokenPrefix, &t.CreatedAt, &t.LastUsedAt, &t.ExpiresAt)
	return t, err
}

// List returns a user's active (non-revoked) tokens, newest first.
func (s *TokenStore) List(userID int64) ([]models.PersonalAccessToken, error) {
	rows, err := s.db.Query(
		`SELECT `+tokenCols+` FROM personal_access_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tokens := []models.PersonalAccessToken{}
	for rows.Next() {
		var t models.PersonalAccessToken
		if err := rows.Scan(&t.ID, &t.Name, &t.TokenPrefix, &t.CreatedAt, &t.LastUsedAt, &t.ExpiresAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, rows.Err()
}

// Revoke marks a user-owned, not-yet-revoked token as revoked. Returns
// sql.ErrNoRows if no such token exists (wrong owner, already revoked, or
// unknown id) so the controller can respond 404 without distinguishing why.
func (s *TokenStore) Revoke(userID, tokenID int64) error {
	res, err := s.db.Exec(
		`UPDATE personal_access_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
		tokenID, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// GetActiveByHash is the auth-path lookup: an active (non-revoked,
// non-expired) token matching hash. Returns sql.ErrNoRows if none matches —
// callers must not distinguish "unknown" from "revoked" from "expired" in the
// response, to avoid leaking which case applies.
func (s *TokenStore) GetActiveByHash(hash string) (id, userID int64, err error) {
	err = s.db.QueryRow(
		`SELECT id, user_id FROM personal_access_tokens
		 WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
		hash,
	).Scan(&id, &userID)
	return id, userID, err
}

// TouchLastUsed is best-effort bookkeeping only (drives the "last used"
// display) — callers should not fail a request over its error.
func (s *TokenStore) TouchLastUsed(id int64) error {
	_, err := s.db.Exec(`UPDATE personal_access_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`, id)
	return err
}

// ─── JWT revocation ────────────────────────────────────────────────────────
//
// Access and refresh tokens are stateless JWTs, so revoking one means recording
// a denial. Two levers, chosen so the common path costs nothing extra:
// token_version invalidates all of a user's tokens at once (it rides along on
// the users row Auth already reads), while revoked_tokens denies one specific
// jti so logging out of a phone doesn't sign you out of a laptop.

// RevokeJWT denies a single JWT by its jti until it would have expired anyway.
// Idempotent: revoking the same token twice is not an error. Distinct from
// Revoke above, which retires a personal access token by row id.
func (s *TokenStore) RevokeJWT(jti string, userID int64, expiresAt time.Time) error {
	// Stored as UTC and compared against an explicit UTC bound below rather
	// than SQLite's CURRENT_TIMESTAMP: CURRENT_TIMESTAMP is UTC while Go's
	// time.Now() is local, and mixing the two made the purge delete denials for
	// tokens that had not expired — silently reviving logged-out sessions.
	_, err := s.db.Exec(
		`INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)
		 ON CONFLICT(jti) DO NOTHING`,
		jti, userID, expiresAt.UTC(),
	)
	return err
}

// IsJWTRevoked reports whether a jti has been denied. An empty jti means a token
// minted before revocation existed; those are treated as revoked so that
// upgrading the server invalidates pre-upgrade tokens rather than leaving a
// population of permanently unrevocable credentials in circulation.
func (s *TokenStore) IsJWTRevoked(jti string) (bool, error) {
	if jti == "" {
		return true, nil
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM revoked_tokens WHERE jti = ?`, jti).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// PurgeExpiredRevocations drops denial rows for tokens that have expired on
// their own — past that point the signature check rejects them anyway, so the
// row is dead weight. Called periodically from main.
func (s *TokenStore) PurgeExpiredRevocations() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM revoked_tokens WHERE expires_at < ?`, time.Now().UTC())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
