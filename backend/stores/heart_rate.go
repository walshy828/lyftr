package stores

import (
	"database/sql"
	"time"

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
	q += clause + ` GROUP BY day ORDER BY day ASC`

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

// maxGapForZones is the longest silence between two consecutive samples that
// still counts as "in zone" for the earlier sample. Health Connect doesn't
// sample continuously (the watch isn't always worn, or samples arrive
// sparsely between workouts) — without a cap, an overnight gap between the
// last evening reading and the first morning one would attribute several
// hours of zone time to a single stale sample. 15 minutes is generous enough
// to cover typical background (non-workout) sampling cadence, which is often
// every 5-15 minutes rather than continuous — a tighter cap would silently
// exclude most non-workout time from every zone, undercounting the day.
const maxGapForZones = 15 * time.Minute

// ZoneMinutes computes per-day time-in-zone from raw samples, in Go rather
// than SQL: HeartRateSample.RecordedAt is scanned into a real time.Time by
// the driver (unlike the raw text heartRateDayExpr works around above), so
// ordering and subtracting timestamps here is exact regardless of how the
// column happens to be stored on disk — no date-parsing pitfalls to dodge.
//
// Each sample's bpm is assumed to hold from that sample until the next one
// (capped at maxGapForZones), and its duration is credited to whichever zone
// that bpm falls in. Zone boundaries are percentages of maxHR (the standard
// 5-zone model): <50% below zone 1, then 50/60/70/80/90% cutoffs for zones
// 1-5. Days are calendar days by the sample's own timestamp (UTC), matching
// DailyStats above.
func (s *HeartRateStore) ZoneMinutes(uid int64, from, to sql.NullTime, maxHR int) ([]models.HeartRateZoneMinutes, error) {
	q := `SELECT recorded_at, bpm FROM heart_rate_samples WHERE user_id = ?`
	args := []any{uid}
	clause, args := dateRangeClause("recorded_at", from, to, args)
	q += clause + ` ORDER BY recorded_at ASC`

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byDay := map[string]*models.HeartRateZoneMinutes{}
	order := []string{}
	var prevAt time.Time
	var prevBPM int
	havePrev := false

	for rows.Next() {
		var at time.Time
		var bpm int
		if err := rows.Scan(&at, &bpm); err != nil {
			return nil, err
		}
		if havePrev {
			gap := at.Sub(prevAt)
			if gap > 0 && gap <= maxGapForZones {
				day := prevAt.UTC().Format("2006-01-02")
				d, ok := byDay[day]
				if !ok {
					d = &models.HeartRateZoneMinutes{Day: day, MaxHR: maxHR}
					byDay[day] = d
					order = append(order, day)
				}
				addZoneMinutes(d, prevBPM, maxHR, gap.Minutes())
			}
		}
		prevAt, prevBPM, havePrev = at, bpm, true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]models.HeartRateZoneMinutes, len(order))
	for i, day := range order {
		out[i] = *byDay[day]
	}
	return out, nil
}

// ZoneMinutesForSession computes time-in-zone plus the max observed BPM over
// a single [start, end] window (a cardio session), rather than per calendar
// day — same sample-holds-until-next-sample logic as ZoneMinutes, but
// returning one aggregate for the window instead of bucketing by day. maxBPM
// is 0 when there are no samples in the window at all.
func (s *HeartRateStore) ZoneMinutesForSession(uid int64, start, end time.Time, maxHR int) (zones models.HeartRateZoneMinutes, maxBPM int, err error) {
	rows, err := s.db.Query(
		`SELECT recorded_at, bpm FROM heart_rate_samples
		  WHERE user_id = ? AND recorded_at >= ? AND recorded_at <= ?
		  ORDER BY recorded_at ASC`,
		uid, start, end,
	)
	if err != nil {
		return zones, 0, err
	}
	defer rows.Close()

	zones = models.HeartRateZoneMinutes{Day: start.UTC().Format("2006-01-02"), MaxHR: maxHR}
	var prevAt time.Time
	var prevBPM int
	havePrev := false

	for rows.Next() {
		var at time.Time
		var bpm int
		if err := rows.Scan(&at, &bpm); err != nil {
			return zones, 0, err
		}
		if bpm > maxBPM {
			maxBPM = bpm
		}
		if havePrev {
			gap := at.Sub(prevAt)
			if gap > 0 && gap <= maxGapForZones {
				addZoneMinutes(&zones, prevBPM, maxHR, gap.Minutes())
			}
		}
		prevAt, prevBPM, havePrev = at, bpm, true
	}
	if err := rows.Err(); err != nil {
		return zones, 0, err
	}
	return zones, maxBPM, nil
}

// addZoneMinutes credits `minutes` to the zone bucket bpm falls into, as a
// percentage of maxHR: <50% below zone 1, 50/60/70/80/90% the zone 1-5 cutoffs.
func addZoneMinutes(d *models.HeartRateZoneMinutes, bpm, maxHR int, minutes float64) {
	if maxHR <= 0 {
		return
	}
	pct := float64(bpm) / float64(maxHR) * 100
	switch {
	case pct < 50:
		d.BelowZone1Mins += minutes
	case pct < 60:
		d.Zone1Minutes += minutes
	case pct < 70:
		d.Zone2Minutes += minutes
	case pct < 80:
		d.Zone3Minutes += minutes
	case pct < 90:
		d.Zone4Minutes += minutes
	default:
		d.Zone5Minutes += minutes
	}
}
