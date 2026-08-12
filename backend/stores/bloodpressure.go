package stores

import (
	"database/sql"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// BloodPressureStore owns all SQL for the blood_pressure_logs entity.
type BloodPressureStore struct{ db *sql.DB }

func NewBloodPressureStore(db *sql.DB) *BloodPressureStore {
	return &BloodPressureStore{db: db}
}

// BPFilter holds resolved (already TZ-adjusted) query bounds. As with
// WeightFilter, the controller owns the calendar-day → UTC-window widening and
// passes the resolved bounds.
type BPFilter struct {
	Limit, Offset int
	From, To      *time.Time // nil = unbounded
}

const bpCols = `id, user_id, systolic, diastolic, pulse, context, arm, position,
                rested, notes, tz_offset, logged_at, created_at`

func scanBP(sc interface{ Scan(...any) error }) (models.BloodPressureLog, error) {
	var b models.BloodPressureLog
	err := sc.Scan(&b.ID, &b.UserID, &b.Systolic, &b.Diastolic, &b.Pulse,
		&b.Context, &b.Arm, &b.Position, &b.Rested, &b.Notes,
		&b.TZOffset, &b.LoggedAt, &b.CreatedAt)
	return b, err
}

func (s *BloodPressureStore) List(uid int64, f BPFilter) ([]models.BloodPressureLog, error) {
	q := `SELECT ` + bpCols + ` FROM blood_pressure_logs WHERE user_id = ?`
	args := []any{uid}
	if f.From != nil {
		q += ` AND logged_at >= ?`
		args = append(args, *f.From)
	}
	if f.To != nil {
		q += ` AND logged_at < ?`
		args = append(args, *f.To)
	}
	q += ` ORDER BY logged_at DESC, id DESC LIMIT ? OFFSET ?`
	args = append(args, f.Limit, f.Offset)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	logs := []models.BloodPressureLog{}
	for rows.Next() {
		b, err := scanBP(rows)
		if err != nil {
			return nil, err
		}
		logs = append(logs, b)
	}
	return logs, rows.Err()
}

// ListSince returns every reading in the last `days` days, oldest first and
// uncapped by pagination. This is the analytics read: the windowing, session
// grouping, and averaging all live in utils/bloodpressure.go, so this returns
// raw rows and makes no judgements about them.
func (s *BloodPressureStore) ListSince(uid int64, days int) ([]models.BloodPressureLog, error) {
	cutoff := time.Now().UTC().AddDate(0, 0, -days)
	rows, err := s.db.Query(
		`SELECT `+bpCols+` FROM blood_pressure_logs
		 WHERE user_id = ? AND logged_at >= ?
		 ORDER BY logged_at ASC, id ASC`,
		uid, cutoff,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	logs := []models.BloodPressureLog{}
	for rows.Next() {
		b, err := scanBP(rows)
		if err != nil {
			return nil, err
		}
		logs = append(logs, b)
	}
	return logs, rows.Err()
}

// get reads a single row by id (no user scope — used after a user-scoped write).
func (s *BloodPressureStore) get(id int64) (models.BloodPressureLog, error) {
	return scanBP(s.db.QueryRow(`SELECT `+bpCols+` FROM blood_pressure_logs WHERE id = ?`, id))
}

// Get returns one user-owned entry, or sql.ErrNoRows.
func (s *BloodPressureStore) Get(uid, id int64) (models.BloodPressureLog, error) {
	return scanBP(s.db.QueryRow(
		`SELECT `+bpCols+` FROM blood_pressure_logs WHERE id = ? AND user_id = ?`, id, uid))
}

// Create inserts a reading. A single statement, so deliberately no inTx.
// req.LoggedAt must already be normalized to UTC.
func (s *BloodPressureStore) Create(uid int64, req models.LogBloodPressureRequest) (models.BloodPressureLog, error) {
	res, err := s.db.Exec(
		`INSERT INTO blood_pressure_logs
		 (user_id, systolic, diastolic, pulse, context, arm, position, rested, notes, tz_offset, logged_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uid, req.Systolic, req.Diastolic, req.Pulse, req.Context, req.Arm,
		req.Position, req.Rested, req.Notes, req.TZOffset, req.LoggedAt,
	)
	if err != nil {
		return models.BloodPressureLog{}, err
	}
	id, _ := res.LastInsertId()
	return s.get(id)
}

// Update edits an entry the user owns (sql.ErrNoRows if not theirs). Unlike
// WeightStore.Update there is no same-day dedup — multiple readings per day are
// the point.
func (s *BloodPressureStore) Update(uid, id int64, req models.LogBloodPressureRequest) (models.BloodPressureLog, error) {
	res, err := s.db.Exec(
		`UPDATE blood_pressure_logs
		 SET systolic = ?, diastolic = ?, pulse = ?, context = ?, arm = ?,
		     position = ?, rested = ?, notes = ?, tz_offset = ?, logged_at = ?
		 WHERE id = ? AND user_id = ?`,
		req.Systolic, req.Diastolic, req.Pulse, req.Context, req.Arm,
		req.Position, req.Rested, req.Notes, req.TZOffset, req.LoggedAt, id, uid,
	)
	if err != nil {
		return models.BloodPressureLog{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return models.BloodPressureLog{}, sql.ErrNoRows
	}
	return s.get(id)
}

func (s *BloodPressureStore) Delete(uid, id int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM blood_pressure_logs WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// Count returns the user's total number of readings — the cheap "has any data"
// check, so callers don't have to load rows to find out.
func (s *BloodPressureStore) Count(uid int64) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM blood_pressure_logs WHERE user_id = ?`, uid).Scan(&n)
	return n, err
}
