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
