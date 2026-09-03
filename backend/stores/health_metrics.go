package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// HealthMetricStore owns all SQL for the health_metrics entity — one table
// for every scalar Health Connect metric (HRV, SpO2, resting heart rate,
// active calories, VO2 max, floors climbed), distinguished by metric_type.
type HealthMetricStore struct{ db *sql.DB }

func NewHealthMetricStore(db *sql.DB) *HealthMetricStore {
	return &HealthMetricStore{db: db}
}

const healthMetricCols = `id, user_id, metric_type, external_id, recorded_at, value, unit, source, created_at`

func scanHealthMetric(sc interface{ Scan(...any) error }) (models.HealthMetric, error) {
	var m models.HealthMetric
	err := sc.Scan(&m.ID, &m.UserID, &m.MetricType, &m.ExternalID, &m.RecordedAt, &m.Value, &m.Unit, &m.Source, &m.CreatedAt)
	return m, err
}

// List returns metrics of metricType (or every type, if empty) in [from, to], newest first.
func (s *HealthMetricStore) List(uid int64, metricType string, from, to sql.NullTime) ([]models.HealthMetric, error) {
	q := `SELECT ` + healthMetricCols + ` FROM health_metrics WHERE user_id = ?`
	args := []any{uid}
	if metricType != "" {
		q += ` AND metric_type = ?`
		args = append(args, metricType)
	}
	clause, args := dateRangeClause("recorded_at", from, to, args)
	q += clause + ` ORDER BY recorded_at DESC`

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	metrics := []models.HealthMetric{}
	for rows.Next() {
		m, err := scanHealthMetric(rows)
		if err != nil {
			return nil, err
		}
		metrics = append(metrics, m)
	}
	return metrics, rows.Err()
}

// Latest returns the most recent reading for a metric type, or sql.ErrNoRows.
func (s *HealthMetricStore) Latest(uid int64, metricType string) (models.HealthMetric, error) {
	return scanHealthMetric(s.db.QueryRow(
		`SELECT `+healthMetricCols+` FROM health_metrics
		 WHERE user_id = ? AND metric_type = ?
		 ORDER BY recorded_at DESC LIMIT 1`,
		uid, metricType,
	))
}

type healthMetricImportResult struct{ Imported, Updated int }

// Import upserts every metric in the batch, matched on (user_id, metric_type, external_id).
// Mirrors CardioStore.Import's resubmit-safe upsert.
func (s *HealthMetricStore) Import(uid int64, reqs []models.CreateHealthMetricRequest) (imported, updated int, err error) {
	res, err := inTx(s.db, func(tx *sql.Tx) (healthMetricImportResult, error) {
		existing := map[string]bool{}
		rows, err := tx.Query(`SELECT metric_type || ':' || external_id FROM health_metrics WHERE user_id = ?`, uid)
		if err != nil {
			return healthMetricImportResult{}, err
		}
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				rows.Close()
				return healthMetricImportResult{}, err
			}
			existing[key] = true
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return healthMetricImportResult{}, err
		}
		rows.Close()

		var r healthMetricImportResult
		for _, req := range reqs {
			source := req.Source
			if source == "" {
				source = "health_connect"
			}
			_, err := tx.Exec(
				`INSERT INTO health_metrics (user_id, metric_type, external_id, recorded_at, value, unit, source)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(user_id, metric_type, external_id) DO UPDATE SET
				   recorded_at = excluded.recorded_at,
				   value       = excluded.value,
				   unit        = excluded.unit`,
				uid, req.MetricType, req.ExternalID, req.RecordedAt, req.Value, req.Unit, source,
			)
			if err != nil {
				return healthMetricImportResult{}, err
			}
			if existing[req.MetricType+":"+req.ExternalID] {
				r.Updated++
			} else {
				r.Imported++
			}
		}
		return r, nil
	})
	return res.Imported, res.Updated, err
}
