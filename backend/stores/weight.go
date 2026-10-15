package stores

import (
	"database/sql"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// WeightStore owns all SQL for the weight_logs entity.
type WeightStore struct{ db *sql.DB }

func NewWeightStore(db *sql.DB) *WeightStore { return &WeightStore{db: db} }

// WeightFilter holds resolved (already TZ-adjusted) query bounds. The controller
// owns the calendar-day → UTC-window widening and passes the resolved bounds.
type WeightFilter struct {
	Limit, Offset int
	From, To      *time.Time // nil = unbounded
}

// WeightStats is the computed summary for GetWeightStats.
type WeightStats struct {
	Latest, Starting, Min, Max, Avg float64
	TotalEntries                    int
	Change7d, Change30d             float64
}

// Reads go through a LEFT JOIN so every consumer gets the clothing-adjusted
// weight in the `weight` position (raw - profile offset). An entry with no
// profile (NULL) has offset 0, i.e. is returned as logged.
const (
	weightFrom = ` FROM weight_logs w LEFT JOIN clothing_profiles c ON c.id = w.clothing_profile_id`
	adjWeight  = `(w.weight - COALESCE(c.offset_lbs, 0))`
	weightCols = `w.id, w.user_id, ` + adjWeight + `, w.weight, w.clothing_profile_id, COALESCE(c.offset_lbs, 0), w.notes, w.logged_at, w.created_at`
)

type rowScanner interface{ Scan(dest ...any) error }

func scanWeight(r rowScanner) (models.WeightLog, error) {
	var w models.WeightLog
	err := r.Scan(&w.ID, &w.UserID, &w.Weight, &w.RawWeight, &w.ClothingProfileID, &w.ClothingOffset, &w.Notes, &w.LoggedAt, &w.CreatedAt)
	return w, err
}

func (s *WeightStore) List(uid int64, f WeightFilter) ([]models.WeightLog, error) {
	q := `SELECT ` + weightCols + weightFrom + ` WHERE w.user_id = ?`
	args := []any{uid}
	if f.From != nil {
		q += ` AND w.logged_at >= ?`
		args = append(args, *f.From)
	}
	if f.To != nil {
		q += ` AND w.logged_at < ?`
		args = append(args, *f.To)
	}
	q += ` ORDER BY w.logged_at DESC, w.id DESC LIMIT ? OFFSET ?`
	args = append(args, f.Limit, f.Offset)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	logs := []models.WeightLog{}
	for rows.Next() {
		w, err := scanWeight(rows)
		if err != nil {
			return nil, err
		}
		logs = append(logs, w)
	}
	return logs, rows.Err()
}

// get reads a single row by id (no user scope — used after a user-scoped write).
func (s *WeightStore) get(id int64) (models.WeightLog, error) {
	return scanWeight(s.db.QueryRow(`SELECT `+weightCols+weightFrom+` WHERE w.id = ?`, id))
}

// Get returns one user-owned entry, or sql.ErrNoRows.
func (s *WeightStore) Get(uid, id int64) (models.WeightLog, error) {
	return scanWeight(s.db.QueryRow(`SELECT `+weightCols+weightFrom+` WHERE w.id = ? AND w.user_id = ?`, id, uid))
}

// dayBounds returns [00:00, next 00:00) for the given instant's calendar day.
// Range match (not SQLite date()) because timestamps store in Go's time.String
// format which date() can't parse.
func dayBounds(t time.Time) (time.Time, time.Time) {
	start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	return start, start.AddDate(0, 0, 1)
}

// UpsertForDay enforces one entry per calendar day: update the day's existing
// entry if present, else insert. req.LoggedAt must already be normalized to UTC.
func (s *WeightStore) UpsertForDay(uid int64, req models.LogWeightRequest) (models.WeightLog, error) {
	dayStart, dayEnd := dayBounds(req.LoggedAt)
	// Atomic check-then-write: without the transaction the connection is released
	// between the SELECT and the write, so two same-day logs could both miss the
	// row and both insert (duplicate day).
	id, err := inTx(s.db, func(tx *sql.Tx) (int64, error) {
		var id int64
		err := tx.QueryRow(
			`SELECT id FROM weight_logs WHERE user_id = ? AND logged_at >= ? AND logged_at < ? ORDER BY id DESC LIMIT 1`,
			uid, dayStart, dayEnd,
		).Scan(&id)
		switch err {
		case nil:
			if _, e := tx.Exec(
				`UPDATE weight_logs SET weight = ?, notes = ?, logged_at = ?, clothing_profile_id = COALESCE(?, clothing_profile_id) WHERE id = ?`,
				req.Weight, req.Notes, req.LoggedAt, req.ClothingProfileID, id,
			); e != nil {
				return 0, e
			}
		case sql.ErrNoRows:
			res, e := tx.Exec(
				`INSERT INTO weight_logs (user_id, weight, notes, logged_at, clothing_profile_id)
				 VALUES (?, ?, ?, ?, COALESCE(?, (SELECT id FROM clothing_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1)))`,
				uid, req.Weight, req.Notes, req.LoggedAt, req.ClothingProfileID, uid,
			)
			if e != nil {
				return 0, e
			}
			id, _ = res.LastInsertId()
		default:
			return 0, err
		}
		return id, nil
	})
	if err != nil {
		return models.WeightLog{}, err
	}
	return s.get(id)
}

// Update edits an entry the user owns (sql.ErrNoRows if not theirs), then drops
// any other same-day entry so the day keeps a single entry. req.LoggedAt UTC.
func (s *WeightStore) Update(uid, id int64, req models.LogWeightRequest) (models.WeightLog, error) {
	// Atomic: the row update + the same-day dedup delete must commit together.
	if err := inTxDo(s.db, func(tx *sql.Tx) error {
		res, err := tx.Exec(
			`UPDATE weight_logs SET weight = ?, notes = ?, logged_at = ?, clothing_profile_id = COALESCE(?, clothing_profile_id) WHERE id = ? AND user_id = ?`,
			req.Weight, req.Notes, req.LoggedAt, req.ClothingProfileID, id, uid,
		)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sql.ErrNoRows
		}
		dayStart, dayEnd := dayBounds(req.LoggedAt)
		_, err = tx.Exec(
			`DELETE FROM weight_logs WHERE user_id = ? AND id != ? AND logged_at >= ? AND logged_at < ?`,
			uid, id, dayStart, dayEnd,
		)
		return err
	}); err != nil {
		return models.WeightLog{}, err
	}
	return s.get(id)
}

func (s *WeightStore) Delete(uid, id int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM weight_logs WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *WeightStore) Stats(uid int64) (WeightStats, error) {
	var latest, oldest, minW, maxW, avgW sql.NullFloat64
	var count int
	err := s.db.QueryRow(
		`SELECT
		  (SELECT `+adjWeight+weightFrom+` WHERE w.user_id = ? ORDER BY w.logged_at DESC, w.id DESC LIMIT 1),
		  (SELECT `+adjWeight+weightFrom+` WHERE w.user_id = ? ORDER BY w.logged_at ASC, w.id ASC LIMIT 1),
		  MIN(`+adjWeight+`), MAX(`+adjWeight+`), AVG(`+adjWeight+`), COUNT(*)
		 `+weightFrom+` WHERE w.user_id = ?`,
		uid, uid, uid,
	).Scan(&latest, &oldest, &minW, &maxW, &avgW, &count)
	if err != nil {
		return WeightStats{}, err
	}
	stats := WeightStats{
		Latest: latest.Float64, Starting: oldest.Float64,
		Min: minW.Float64, Max: maxW.Float64, Avg: avgW.Float64,
		TotalEntries: count,
	}
	if stats.Change7d, err = s.changeOver(uid, 7); err != nil {
		return WeightStats{}, err
	}
	if stats.Change30d, err = s.changeOver(uid, 30); err != nil {
		return WeightStats{}, err
	}
	return stats, nil
}

// changeOver returns latest minus earliest weight within the last `days` days,
// or 0 with fewer than two entries in the window.
func (s *WeightStore) changeOver(uid int64, days int) (float64, error) {
	cutoff := time.Now().UTC().AddDate(0, 0, -days)
	var latest, earliest sql.NullFloat64
	if err := s.db.QueryRow(
		`SELECT
		  (SELECT `+adjWeight+weightFrom+` WHERE w.user_id = ? AND w.logged_at >= ? ORDER BY w.logged_at DESC, w.id DESC LIMIT 1),
		  (SELECT `+adjWeight+weightFrom+` WHERE w.user_id = ? AND w.logged_at >= ? ORDER BY w.logged_at ASC, w.id ASC LIMIT 1)`,
		uid, cutoff, uid, cutoff,
	).Scan(&latest, &earliest); err != nil {
		return 0, err
	}
	if !latest.Valid || !earliest.Valid {
		return 0, nil
	}
	return latest.Float64 - earliest.Float64, nil
}
