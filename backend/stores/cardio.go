package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// CardioStore owns all SQL for the cardio_sessions entity.
type CardioStore struct{ db *sql.DB }

func NewCardioStore(db *sql.DB) *CardioStore {
	return &CardioStore{db: db}
}

// CardioFilter mirrors BPFilter's shape: resolved (already TZ-adjusted) query
// bounds, owned by the controller.
type CardioFilter struct {
	Limit, Offset int
}

const cardioCols = `id, user_id, external_id, activity_type, started_at, ended_at,
                     duration_seconds, distance_meters, avg_heart_rate, calories,
                     source, created_at`

func scanCardio(sc interface{ Scan(...any) error }) (models.CardioSession, error) {
	var s models.CardioSession
	err := sc.Scan(&s.ID, &s.UserID, &s.ExternalID, &s.ActivityType, &s.StartedAt,
		&s.EndedAt, &s.DurationSeconds, &s.DistanceMeters, &s.AvgHeartRate,
		&s.Calories, &s.Source, &s.CreatedAt)
	return s, err
}

func (s *CardioStore) List(uid int64, f CardioFilter) ([]models.CardioSession, error) {
	rows, err := s.db.Query(
		`SELECT `+cardioCols+` FROM cardio_sessions
		 WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
		uid, f.Limit, f.Offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := []models.CardioSession{}
	for rows.Next() {
		c, err := scanCardio(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

// get reads a single row by id (no user scope — used after a user-scoped write).
func (s *CardioStore) get(id int64) (models.CardioSession, error) {
	return scanCardio(s.db.QueryRow(`SELECT `+cardioCols+` FROM cardio_sessions WHERE id = ?`, id))
}

// Get returns one user-owned session, or sql.ErrNoRows.
func (s *CardioStore) Get(uid, id int64) (models.CardioSession, error) {
	return scanCardio(s.db.QueryRow(
		`SELECT `+cardioCols+` FROM cardio_sessions WHERE id = ? AND user_id = ?`, id, uid))
}

// Import inserts every session that isn't already present for this user
// (matched on external_id), so a sync job can resubmit its whole batch on
// every run with no need to track what it already sent. Returns the count of
// rows actually inserted.
func (s *CardioStore) Import(uid int64, reqs []models.CreateCardioSessionRequest) (int, error) {
	return inTx(s.db, func(tx *sql.Tx) (int, error) {
		imported := 0
		for _, req := range reqs {
			source := req.Source
			if source == "" {
				source = "health_connect"
			}
			res, err := tx.Exec(
				`INSERT INTO cardio_sessions
				 (user_id, external_id, activity_type, started_at, ended_at,
				  duration_seconds, distance_meters, avg_heart_rate, calories, source)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(user_id, external_id) DO NOTHING`,
				uid, req.ExternalID, req.ActivityType, req.StartedAt, req.EndedAt,
				req.DurationSeconds, req.DistanceMeters, req.AvgHeartRate, req.Calories, source,
			)
			if err != nil {
				return 0, err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				imported++
			}
		}
		return imported, nil
	})
}

func (s *CardioStore) Delete(uid, id int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM cardio_sessions WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
