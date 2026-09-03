package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// HeartRateStore owns all SQL for the heart_rate_samples entity.
type HeartRateStore struct{ db *sql.DB }

func NewHeartRateStore(db *sql.DB) *HeartRateStore {
	return &HeartRateStore{db: db}
}

const heartRateCols = `id, user_id, external_id, recorded_at, bpm, source, created_at`

func scanHeartRate(sc interface{ Scan(...any) error }) (models.HeartRateSample, error) {
	var s models.HeartRateSample
	err := sc.Scan(&s.ID, &s.UserID, &s.ExternalID, &s.RecordedAt, &s.BPM, &s.Source, &s.CreatedAt)
	return s, err
}

// dateRangeClause builds "AND col >= ?"/"AND col <= ?" fragments for an
// optional [from, to] bound, appending only the args actually used — mirrors
// WeightStore.List's dynamic query building (nil bounds add no clause at all,
// rather than an always-true placeholder comparison).
func dateRangeClause(col string, from, to sql.NullTime, args []any) (string, []any) {
	q := ""
	if from.Valid {
		q += " AND " + col + " >= ?"
		args = append(args, from.Time)
	}
	if to.Valid {
		q += " AND " + col + " <= ?"
		args = append(args, to.Time)
	}
	return q, args
}

// List returns samples in [from, to], newest first.
func (s *HeartRateStore) List(uid int64, from, to sql.NullTime) ([]models.HeartRateSample, error) {
	q := `SELECT ` + heartRateCols + ` FROM heart_rate_samples WHERE user_id = ?`
	args := []any{uid}
	clause, args := dateRangeClause("recorded_at", from, to, args)
	q += clause + ` ORDER BY recorded_at DESC`

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	samples := []models.HeartRateSample{}
	for rows.Next() {
		hr, err := scanHeartRate(rows)
		if err != nil {
			return nil, err
		}
		samples = append(samples, hr)
	}
	return samples, rows.Err()
}

// heartRateImportResult mirrors cardio's importResult.
type heartRateImportResult struct{ Imported, Updated int }

// Import upserts every sample in the batch, matched on (user_id, external_id).
// Mirrors CardioStore.Import's resubmit-safe upsert, but callers on the
// Android side should NOT resubmit the whole history every run for this
// entity — raw HR volume makes that expensive; use a sync watermark instead
// (see android/phone's HealthMetricsSyncWorker) and rely on this dedup only
// for the (rare) case a sample is re-sent.
func (s *HeartRateStore) Import(uid int64, reqs []models.CreateHeartRateSampleRequest) (imported, updated int, err error) {
	res, err := inTx(s.db, func(tx *sql.Tx) (heartRateImportResult, error) {
		existing := map[string]bool{}
		rows, err := tx.Query(`SELECT external_id FROM heart_rate_samples WHERE user_id = ?`, uid)
		if err != nil {
			return heartRateImportResult{}, err
		}
		for rows.Next() {
			var extID string
			if err := rows.Scan(&extID); err != nil {
				rows.Close()
				return heartRateImportResult{}, err
			}
			existing[extID] = true
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return heartRateImportResult{}, err
		}
		rows.Close()

		var r heartRateImportResult
		for _, req := range reqs {
			source := req.Source
			if source == "" {
				source = "health_connect"
			}
			_, err := tx.Exec(
				`INSERT INTO heart_rate_samples (user_id, external_id, recorded_at, bpm, source)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(user_id, external_id) DO UPDATE SET
				   recorded_at = excluded.recorded_at,
				   bpm         = excluded.bpm`,
				uid, req.ExternalID, req.RecordedAt, req.BPM, source,
			)
			if err != nil {
				return heartRateImportResult{}, err
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

// heartRateDayExpr buckets a sample into a calendar day. recorded_at is bound
// as a raw Go time.Time on insert (same write path as cardio_sessions.started_at),
// which SQLite's date() can fail to parse depending on Go's chosen layout —
// see cardioDayExpr in cardio_stats.go for the same issue verified there.
const heartRateDayExpr = `COALESCE(date(recorded_at), substr(recorded_at, 1, 10))`

// DailyStats rolls samples up into per-day min/avg/max, computed in SQL.
func (s *HeartRateStore) DailyStats(uid int64, from, to sql.NullTime) ([]models.HeartRateDailyStat, error) {
	q := `SELECT ` + heartRateDayExpr + ` AS day, MIN(bpm), CAST(ROUND(AVG(bpm)) AS INTEGER), MAX(bpm), COUNT(*)
	        FROM heart_rate_samples WHERE user_id = ?`
	args := []any{uid}
	clause, args := dateRangeClause("recorded_at", from, to, args)
	q += clause + ` GROUP BY day ORDER BY day DESC`

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := []models.HeartRateDailyStat{}
	for rows.Next() {
		var d models.HeartRateDailyStat
		if err := rows.Scan(&d.Day, &d.Min, &d.Avg, &d.Max, &d.Count); err != nil {
			return nil, err
		}
		stats = append(stats, d)
	}
	return stats, rows.Err()
}
