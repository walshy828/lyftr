package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// SleepStore owns all SQL for the sleep_sessions/sleep_stages entities.
type SleepStore struct{ db *sql.DB }

func NewSleepStore(db *sql.DB) *SleepStore {
	return &SleepStore{db: db}
}

const sleepSessionCols = `id, user_id, external_id, started_at, ended_at, source, created_at`

func scanSleepSession(sc interface{ Scan(...any) error }) (models.SleepSession, error) {
	var s models.SleepSession
	err := sc.Scan(&s.ID, &s.UserID, &s.ExternalID, &s.StartedAt, &s.EndedAt, &s.Source, &s.CreatedAt)
	return s, err
}

func (s *SleepStore) stagesFor(id int64) ([]models.SleepStage, error) {
	rows, err := s.db.Query(
		`SELECT id, sleep_session_id, stage_type, started_at, ended_at
		   FROM sleep_stages WHERE sleep_session_id = ? ORDER BY started_at`,
		id,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stages := []models.SleepStage{}
	for rows.Next() {
		var st models.SleepStage
		if err := rows.Scan(&st.ID, &st.SleepSessionID, &st.StageType, &st.StartedAt, &st.EndedAt); err != nil {
			return nil, err
		}
		stages = append(stages, st)
	}
	return stages, rows.Err()
}

// List returns sessions in [from, to], newest first, each with its stages.
func (s *SleepStore) List(uid int64, from, to sql.NullTime) ([]models.SleepSession, error) {
	q := `SELECT ` + sleepSessionCols + ` FROM sleep_sessions WHERE user_id = ?`
	args := []any{uid}
	clause, args := dateRangeClause("started_at", from, to, args)
	q += clause + ` ORDER BY started_at DESC`

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := []models.SleepSession{}
	for rows.Next() {
		sess, err := scanSleepSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, sess)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range sessions {
		stages, err := s.stagesFor(sessions[i].ID)
		if err != nil {
			return nil, err
		}
		sessions[i].Stages = stages
	}
	return sessions, nil
}

// Get returns one user-owned session with its stages, or sql.ErrNoRows.
func (s *SleepStore) Get(uid, id int64) (models.SleepSession, error) {
	sess, err := scanSleepSession(s.db.QueryRow(
		`SELECT `+sleepSessionCols+` FROM sleep_sessions WHERE id = ? AND user_id = ?`, id, uid))
	if err != nil {
		return sess, err
	}
	stages, err := s.stagesFor(sess.ID)
	if err != nil {
		return sess, err
	}
	sess.Stages = stages
	return sess, nil
}

type sleepImportResult struct{ Imported, Updated int }

// Import upserts every session in the batch, matched on (user_id, external_id).
// A resubmitted session's stages are replaced wholesale (delete + reinsert)
// rather than diffed — Health Connect is the source of truth and a resubmit
// only happens when its data changed, so a diff would add complexity for no
// benefit over CardioStore.Import's simpler "overwrite" approach.
func (s *SleepStore) Import(uid int64, reqs []models.CreateSleepSessionRequest) (imported, updated int, err error) {
	res, err := inTx(s.db, func(tx *sql.Tx) (sleepImportResult, error) {
		existing := map[string]int64{}
		rows, err := tx.Query(`SELECT id, external_id FROM sleep_sessions WHERE user_id = ?`, uid)
		if err != nil {
			return sleepImportResult{}, err
		}
		for rows.Next() {
			var id int64
			var extID string
			if err := rows.Scan(&id, &extID); err != nil {
				rows.Close()
				return sleepImportResult{}, err
			}
			existing[extID] = id
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return sleepImportResult{}, err
		}
		rows.Close()

		var r sleepImportResult
		for _, req := range reqs {
			source := req.Source
			if source == "" {
				source = "health_connect"
			}
			res, err := tx.Exec(
				`INSERT INTO sleep_sessions (user_id, external_id, started_at, ended_at, source)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(user_id, external_id) DO UPDATE SET
				   started_at = excluded.started_at,
				   ended_at   = excluded.ended_at`,
				uid, req.ExternalID, req.StartedAt, req.EndedAt, source,
			)
			if err != nil {
				return sleepImportResult{}, err
			}

			sessionID, existed := existing[req.ExternalID]
			if !existed {
				sessionID, err = res.LastInsertId()
				if err != nil {
					return sleepImportResult{}, err
				}
			}

			if _, err := tx.Exec(`DELETE FROM sleep_stages WHERE sleep_session_id = ?`, sessionID); err != nil {
				return sleepImportResult{}, err
			}
			for _, stage := range req.Stages {
				if _, err := tx.Exec(
					`INSERT INTO sleep_stages (sleep_session_id, stage_type, started_at, ended_at)
					 VALUES (?, ?, ?, ?)`,
					sessionID, stage.StageType, stage.StartedAt, stage.EndedAt,
				); err != nil {
					return sleepImportResult{}, err
				}
			}

			if existed {
				r.Updated++
			} else {
				r.Imported++
			}
		}
		return r, nil
	})
	return res.Imported, res.Updated, err
}
