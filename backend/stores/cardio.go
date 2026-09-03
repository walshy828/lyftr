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

const cardioCols = `id, user_id, external_id, activity_type, title, started_at, ended_at,
                     duration_seconds, distance_meters, avg_heart_rate, calories, avg_cadence,
                     source, created_at`

func scanCardio(sc interface{ Scan(...any) error }) (models.CardioSession, error) {
	var s models.CardioSession
	err := sc.Scan(&s.ID, &s.UserID, &s.ExternalID, &s.ActivityType, &s.Title, &s.StartedAt,
		&s.EndedAt, &s.DurationSeconds, &s.DistanceMeters, &s.AvgHeartRate,
		&s.Calories, &s.AvgCadence, &s.Source, &s.CreatedAt)
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

// importResult is the outcome of a batch Import, split into rows that were
// newly inserted vs rows that already existed and were overwritten.
type importResult struct{ Imported, Updated int }

// Import upserts every session in the batch, matched on (user_id, external_id).
// A sync job can resubmit its whole batch on every run with no need to track
// what it already sent: new sessions are inserted, and sessions it already
// sent are overwritten with the resubmitted values (Health Connect is the
// source of truth, e.g. the user recategorizes a session after the fact).
func (s *CardioStore) Import(uid int64, reqs []models.CreateCardioSessionRequest) (imported, updated int, err error) {
	res, err := inTx(s.db, func(tx *sql.Tx) (importResult, error) {
		existing := map[string]bool{}
		rows, err := tx.Query(`SELECT external_id FROM cardio_sessions WHERE user_id = ?`, uid)
		if err != nil {
			return importResult{}, err
		}
		for rows.Next() {
			var extID string
			if err := rows.Scan(&extID); err != nil {
				rows.Close()
				return importResult{}, err
			}
			existing[extID] = true
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return importResult{}, err
		}
		rows.Close()

		var r importResult
		for _, req := range reqs {
			source := req.Source
			if source == "" {
				source = "health_connect"
			}
			_, err := tx.Exec(
				`INSERT INTO cardio_sessions
				 (user_id, external_id, activity_type, title, started_at, ended_at,
				  duration_seconds, distance_meters, avg_heart_rate, calories, avg_cadence, source)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(user_id, external_id) DO UPDATE SET
				   activity_type    = excluded.activity_type,
				   title            = excluded.title,
				   started_at       = excluded.started_at,
				   ended_at         = excluded.ended_at,
				   duration_seconds = excluded.duration_seconds,
				   distance_meters  = excluded.distance_meters,
				   avg_heart_rate   = excluded.avg_heart_rate,
				   calories         = excluded.calories,
				   avg_cadence      = excluded.avg_cadence`,
				uid, req.ExternalID, req.ActivityType, req.Title, req.StartedAt, req.EndedAt,
				req.DurationSeconds, req.DistanceMeters, req.AvgHeartRate, req.Calories, req.AvgCadence, source,
			)
			if err != nil {
				return importResult{}, err
			}
			if existing[req.ExternalID] {
				r.Updated++
			} else {
				r.Imported++
			}
		}
		return r, nil
	})
	return res.Imported, res.Updated, err
}

// CardioSummary is an aggregate rollup of cardio sessions over a rolling
// window — the cardio analogue of WorkoutStore.CountSince's day count, but
// carrying the richer fields (duration/distance/calories/heart rate) that
// AI-facing prompts need to reason about Health Connect activity alongside
// strength training.
type CardioSummary struct {
	Days            int     `json:"days"` // distinct calendar days with at least one session
	Sessions        int     `json:"sessions"`
	DurationMinutes int     `json:"duration_minutes"`
	DistanceMeters  float64 `json:"distance_meters"`
	Calories        float64 `json:"calories"`
	AvgHeartRate    float64 `json:"avg_heart_rate"` // 0 when no session in the window recorded one
}

// SummarySince rolls up every cardio session in the last N days. Mirrors
// CountSince's day-window semantics (substr fallback for the day bucket,
// date('now', ?) for the window bound — see the started_at format note on
// cardioDayExpr in cardio_stats.go) so the two stay consistent as sources of
// "how many days has this person trained" for the same user.
func (s *CardioStore) SummarySince(uid int64, days int) (CardioSummary, error) {
	var sum CardioSummary
	var durationSeconds, hrSum float64
	var hrCount int
	err := s.db.QueryRow(
		`SELECT COUNT(DISTINCT substr(started_at, 1, 10)),
		        COUNT(*),
		        COALESCE(SUM(duration_seconds), 0),
		        COALESCE(SUM(distance_meters), 0),
		        COALESCE(SUM(calories), 0),
		        COALESCE(SUM(CASE WHEN avg_heart_rate > 0 THEN avg_heart_rate ELSE 0 END), 0),
		        COALESCE(SUM(CASE WHEN avg_heart_rate > 0 THEN 1 ELSE 0 END), 0)
		   FROM cardio_sessions
		  WHERE user_id = ? AND started_at >= date('now', ?)`,
		uid, dayWindow(days),
	).Scan(&sum.Days, &sum.Sessions, &durationSeconds, &sum.DistanceMeters, &sum.Calories, &hrSum, &hrCount)
	if err != nil {
		return sum, err
	}
	sum.DurationMinutes = int(durationSeconds / 60)
	if hrCount > 0 {
		sum.AvgHeartRate = hrSum / float64(hrCount)
	}
	return sum, nil
}

func (s *CardioStore) Delete(uid, id int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM cardio_sessions WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
