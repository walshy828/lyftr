package stores

// Cardio analytics: day-bucketed rollups and streaks for cardio_sessions,
// mirroring the workout analytics in workout_stats.go so the two domains can
// be merged client-side for the dashboard's consistency heatmap.

// cardioDayExpr buckets a cardio session into the user's LOCAL calendar day.
//
// cardio_sessions.started_at is bound as a raw Go time.Time on insert (see
// CardioStore.Import), same as workouts.started_at's current write path — with
// modernc.org/sqlite and no _time_format/_loc DSN params, that serializes via
// time.Time.String() (e.g. "2026-08-15 15:22:51.376978 -0400 EDT
// m=+0.005320918"), not RFC3339. SQLite's date() returns NULL on that layout,
// so this needs the same substr(...,1,10) fallback dayExpr uses for workouts
// — verified empirically, not assumed from the source platform's wire format.
const cardioDayExpr = `COALESCE(date(c.started_at, ?1), substr(c.started_at, 1, 10))`

// CardioDay is one calendar day's cardio rollup. Days with no sessions are
// absent rather than zero-filled, matching TrainingDay.
type CardioDay struct {
	Date           string  `json:"date"`
	Sessions       int     `json:"sessions"`
	Duration       int     `json:"duration"` // seconds
	DistanceMeters float64 `json:"distance_meters"`
	Calories       float64 `json:"calories"`
}

// CardioDaily returns per-day cardio rollups for [from, to] in the user's
// local days. Unlike TrainingDaily, no correlated subqueries are needed —
// each cardio_sessions row is already a single pre-aggregated session, not a
// workout with nested sets.
func (s *CardioStore) CardioDaily(uid int64, from, to string, tzOffset int) ([]CardioDay, error) {
	rows, err := s.db.Query(`
		SELECT `+cardioDayExpr+` AS day,
		       COUNT(*)                AS sessions,
		       SUM(duration_seconds)   AS duration,
		       SUM(distance_meters)    AS distance,
		       SUM(calories)           AS calories
		  FROM cardio_sessions c
		 WHERE c.user_id = ?2
		   AND `+cardioDayExpr+` BETWEEN ?3 AND ?4
		 GROUP BY day
		 ORDER BY day ASC
	`, tzModifier(tzOffset), uid, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	days := []CardioDay{}
	for rows.Next() {
		var d CardioDay
		if err := rows.Scan(&d.Date, &d.Sessions, &d.Duration, &d.DistanceMeters, &d.Calories); err != nil {
			return nil, err
		}
		days = append(days, d)
	}
	return days, rows.Err()
}

// CardioStreakFor returns the current and longest run of consecutive days
// with at least one cardio session, over the user's whole history. Same
// gaps-and-islands technique as TrainingStreakFor.
func (s *CardioStore) CardioStreakFor(uid int64, today string, tzOffset int) (TrainingStreak, error) {
	var st TrainingStreak
	err := s.db.QueryRow(`
		WITH days AS (
			SELECT DISTINCT `+cardioDayExpr+` AS day
			  FROM cardio_sessions c
			 WHERE c.user_id = ?2
		),
		grp AS (
			SELECT day, julianday(day) - ROW_NUMBER() OVER (ORDER BY day) AS g
			  FROM days
			 WHERE day IS NOT NULL
		),
		islands AS (
			SELECT COUNT(*) AS len, MAX(day) AS last_day FROM grp GROUP BY g
		)
		SELECT COALESCE(MAX(len), 0),
		       COALESCE(MAX(CASE WHEN last_day >= date(?3, '-1 day') THEN len END), 0)
		  FROM islands
	`, tzModifier(tzOffset), uid, today).Scan(&st.Longest, &st.Current)
	return st, err
}

// CombinedStreakFor returns the current and longest run of consecutive days
// with at least one workout OR at least one cardio session, over the user's
// whole history.
//
// This cannot be derived from TrainingStreakFor's and CardioStreakFor's two
// independent (current, longest) pairs: a workout on day N followed by a
// cardio-only day N+1 should chain into a 2-day combined streak, which
// max(workoutStreak, cardioStreak) would miss entirely (it would report 1).
// The UNION has to happen on the day sets themselves, before gaps-and-islands
// runs — hence this single query spanning both tables. It lives on CardioStore
// (rather than a new package-level function needing its own *sql.DB plumbing
// through Handler) purely because CardioStore.db is already a full database
// handle with no scoping that would prevent it from querying workouts too.
//
// By contrast, the "both" mode's DAILY rollup (as opposed to its streak) is
// deliberately NOT computed this way — two small day-bucketed arrays are
// trivial to sum by date client-side, so no combined daily SQL query exists
// here; see ConsistencyHeatmap's merge logic on the frontend.
func (s *CardioStore) CombinedStreakFor(uid int64, today string, tzOffset int) (TrainingStreak, error) {
	var st TrainingStreak
	err := s.db.QueryRow(`
		WITH days AS (
			SELECT day FROM (
				SELECT DISTINCT `+dayExpr+` AS day FROM workouts w WHERE w.user_id = ?2
				UNION
				SELECT DISTINCT `+cardioDayExpr+` AS day FROM cardio_sessions c WHERE c.user_id = ?2
			)
			WHERE day IS NOT NULL
		),
		grp AS (
			SELECT day, julianday(day) - ROW_NUMBER() OVER (ORDER BY day) AS g
			  FROM days
		),
		islands AS (
			SELECT COUNT(*) AS len, MAX(day) AS last_day FROM grp GROUP BY g
		)
		SELECT COALESCE(MAX(len), 0),
		       COALESCE(MAX(CASE WHEN last_day >= date(?3, '-1 day') THEN len END), 0)
		  FROM islands
	`, tzModifier(tzOffset), uid, today).Scan(&st.Longest, &st.Current)
	return st, err
}
