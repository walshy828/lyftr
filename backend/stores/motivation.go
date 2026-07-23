package stores

import (
	"database/sql"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// MotivationStore owns all SQL for motivation_notes: a weekly-cached
// AI-authored encouragement message, at most one per user per calendar week.
type MotivationStore struct{ db *sql.DB }

func NewMotivationStore(db *sql.DB) *MotivationStore { return &MotivationStore{db: db} }

// CurrentForWeek returns the cached note for the given week (its Monday), or
// sql.ErrNoRows if none has been generated yet this week.
func (s *MotivationStore) CurrentForWeek(uid int64, weekStart time.Time) (models.MotivationNote, error) {
	var n models.MotivationNote
	err := s.db.QueryRow(
		`SELECT id, user_id, week_start, message, created_at FROM motivation_notes WHERE user_id = ? AND week_start = ?`,
		uid, weekStart.Format("2006-01-02"),
	).Scan(&n.ID, &n.UserID, &n.WeekStart, &n.Message, &n.CreatedAt)
	return n, err
}

// Upsert stores (or replaces) the note cached for a given week.
func (s *MotivationStore) Upsert(uid int64, weekStart time.Time, message string) (models.MotivationNote, error) {
	var n models.MotivationNote
	err := s.db.QueryRow(
		`INSERT INTO motivation_notes (user_id, week_start, message) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, week_start) DO UPDATE SET message = excluded.message
		 RETURNING id, user_id, week_start, message, created_at`,
		uid, weekStart.Format("2006-01-02"), message,
	).Scan(&n.ID, &n.UserID, &n.WeekStart, &n.Message, &n.CreatedAt)
	return n, err
}
