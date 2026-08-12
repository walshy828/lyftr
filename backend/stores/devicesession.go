package stores

import (
	"database/sql"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// DeviceSessionStore owns all SQL for device_sessions — one row per chain of
// rotating refresh tokens, keyed by the `sid` JWT claim.
type DeviceSessionStore struct{ db *sql.DB }

func NewDeviceSessionStore(db *sql.DB) *DeviceSessionStore { return &DeviceSessionStore{db: db} }

const deviceSessionCols = `id, label, user_agent, remembered, created_at, last_seen_at, expires_at`

// Create records a new session. Called at login and by the refresh path when it
// adopts a token minted before device sessions existed.
func (s *DeviceSessionStore) Create(id string, userID int64, label, userAgent string, remembered bool, expiresAt time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO device_sessions (id, user_id, label, user_agent, remembered, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO NOTHING`,
		id, userID, label, userAgent, remembered, expiresAt.UTC(),
	)
	return err
}

// IsLive reports whether a session id may still be refreshed: it must exist,
// belong to this user, and be neither revoked nor past its expiry.
//
// Deliberately checked only on the refresh path, not in middleware.Auth. Auth
// already costs two queries on every request and the pool is capped at a single
// connection, so adding a third to each call would tax the whole API to shorten
// a revocation window that the access-token lifetime (an hour by default)
// already bounds. Revoking a device therefore takes effect within one access
// token's life, and the UI says so.
func (s *DeviceSessionStore) IsLive(id string, userID int64) (bool, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM device_sessions
		 WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
		id, userID, time.Now().UTC(),
	).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Touch records activity and slides the row's expiry forward to match the newly
// minted refresh token. Best-effort bookkeeping — it drives the "last seen"
// column and the expiry sweep, and must not fail a refresh.
func (s *DeviceSessionStore) Touch(id string, expiresAt time.Time) error {
	_, err := s.db.Exec(
		`UPDATE device_sessions SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ? WHERE id = ?`,
		expiresAt.UTC(), id,
	)
	return err
}

// List returns the user's live sessions, most recently active first.
func (s *DeviceSessionStore) List(userID int64) ([]models.DeviceSession, error) {
	rows, err := s.db.Query(
		`SELECT `+deviceSessionCols+` FROM device_sessions
		 WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
		 ORDER BY last_seen_at DESC`,
		userID, time.Now().UTC(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.DeviceSession, 0)
	for rows.Next() {
		var d models.DeviceSession
		if err := rows.Scan(&d.ID, &d.Label, &d.UserAgent, &d.Remembered, &d.CreatedAt, &d.LastSeenAt, &d.ExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Revoke retires one of the user's sessions. Scoped by user_id so a guessed id
// can't sign out somebody else, and returns sql.ErrNoRows when nothing matched
// so the controller can answer 404 rather than a misleading success.
func (s *DeviceSessionStore) Revoke(id string, userID int64) error {
	res, err := s.db.Exec(
		`UPDATE device_sessions SET revoked_at = CURRENT_TIMESTAMP
		 WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
		id, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// RevokeAllForUser retires every session a user holds. Used alongside the
// token_version bump on password change so the device list reflects reality
// instead of listing sessions whose tokens are already dead.
func (s *DeviceSessionStore) RevokeAllForUser(userID int64) error {
	_, err := s.db.Exec(
		`UPDATE device_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`,
		userID,
	)
	return err
}

// PurgeExpired drops rows whose refresh tokens have expired anyway — past that
// point the session cannot be resumed, so the row is only clutter. Called from
// the same periodic sweep as PurgeExpiredRevocations.
func (s *DeviceSessionStore) PurgeExpired() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM device_sessions WHERE expires_at < ?`, time.Now().UTC())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
