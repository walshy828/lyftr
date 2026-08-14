package stores

import (
	"fmt"
	"time"
)

// Training analytics: whole-history aggregates for the dashboard, the muscle
// map and the stats screen.
//
// These live in SQL rather than on the client for one reason: correctness at
// scale. The dashboard used to fetch a page of workouts and reduce over it in
// TypeScript, which silently made every "all-time" number a function of the
// page size. An aggregate that has to see all the rows belongs where all the
// rows are.
//
// Every query here is a single round trip. With SetMaxOpenConns(1) the database
// is a serialization point, so an N+1 loop over workouts costs far more than
// the same work expressed as one grouped query.

// dayExpr buckets a workout into the user's LOCAL calendar day.
//
// workouts.started_at holds three historical formats (see lastUsedLayouts in
// program.go): RFC3339, SQLite's CURRENT_TIMESTAMP, and Go's time.Time.String().
// SQLite's date() parses the first two and returns NULL on the third — so a
// bare date() would silently drop the oldest rows out of every statistic. The
// substr fallback keeps them, at the cost of being UTC-ish for those rows only.
//
// The modifier is bound as NUMBERED parameter ?1 rather than a bare `?`: the
// expression appears more than once in a single query, and numbering lets both
// occurrences share one argument. Every query below therefore numbers ALL of
// its parameters — mixing `?` and `?N` in one statement makes the bare ones
// pick up whatever index follows the highest numbered one, which is a trap.
const dayExpr = `COALESCE(date(w.started_at, ?1), substr(w.started_at, 1, 10))`

// tzModifier converts a UTC-offset in minutes into a SQLite date() modifier.
// The client sends -new Date().getTimezoneOffset(); the server has no per-user
// timezone to fall back on, which is exactly why the client is the authority.
func tzModifier(offsetMinutes int) string {
	// Clamp to the real-world range (UTC-12:00 .. UTC+14:00). Out-of-range
	// values can only be a bug or a probe, and an unclamped one lets a caller
	// shift their history by arbitrary months.
	if offsetMinutes < -720 {
		offsetMinutes = -720
	}
	if offsetMinutes > 840 {
		offsetMinutes = 840
	}
	return fmt.Sprintf("%+d minutes", offsetMinutes)
}

// TrainingDay is one calendar day's training rollup. Days with no training are
// absent rather than zero-filled — a year of mostly-empty rows is bytes the
// client can trivially reconstruct, and it renders the grid anyway.
type TrainingDay struct {
	Date      string  `json:"date"`
	Workouts  int     `json:"workouts"`
	Duration  int     `json:"duration"` // seconds
	Volume    float64 `json:"volume"`   // reps x weight, in the user's own unit
	Sets      int     `json:"sets"`
	Exercises int     `json:"exercises"`
}

// MuscleTotal is one muscle group's share of training over the window.
// Muscle groups the user never touched are present with zero counts: the
// neglect signal IS the feature, and it cannot be derived from absence.
type MuscleTotal struct {
	MuscleGroup string  `json:"muscle_group"`
	Sets        int     `json:"sets"`
	Volume      float64 `json:"volume"`
	Reps        int     `json:"reps"`
	Workouts    int     `json:"workouts"`
	// LastTrained is deliberately NOT bounded by the window — "last trained 42
	// days ago" is only meaningful when it can name a date outside it. Empty
	// when the muscle has never been trained.
	LastTrained string `json:"last_trained"`
}

// TrainingStreak counts consecutive calendar days with at least one workout.
type TrainingStreak struct {
	Current int `json:"current"`
	Longest int `json:"longest"`
}

// TrainingTotals summarizes the window. Derived in Go from the daily rows, so
// it costs no extra query.
type TrainingTotals struct {
	Workouts   int     `json:"workouts"`
	Duration   int     `json:"duration"`
	Volume     float64 `json:"volume"`
	Sets       int     `json:"sets"`
	ActiveDays int     `json:"active_days"`
}

// TrainingStats is the composed payload. Sections the caller didn't ask for are
// omitted rather than empty, so the client can tell "you didn't request this"
// apart from "you have no data".
type TrainingStats struct {
	From       string          `json:"from"`
	To         string          `json:"to"`
	WeightUnit string          `json:"weight_unit"`
	Totals     TrainingTotals  `json:"totals"`
	Daily      []TrainingDay   `json:"daily,omitempty"`
	Muscles    []MuscleTotal   `json:"muscles,omitempty"`
	Streak     *TrainingStreak `json:"streak,omitempty"`
}

// completedWorkingSets is the predicate for a set that counts toward training
// volume: actually performed, and not a warmup. Applied identically everywhere
// so the daily totals and the muscle totals can never disagree.
const completedWorkingSets = `s.is_warmup = 0 AND s.completed = 1`

// TrainingDaily returns per-day rollups for [from, to] in the user's local days.
//
// Sets are aggregated per workout in correlated subqueries rather than a flat
// JOIN. A flat join would fan each workout row out to one row per set, which
// multiplies w.duration by the set count — a workout with 18 sets would report
// 18 hours. The subqueries ride idx_workout_exercises_workout and
// idx_sets_workout_exercise.
func (s *WorkoutStore) TrainingDaily(uid int64, from, to string, tzOffset int) ([]TrainingDay, error) {
	rows, err := s.db.Query(`
		SELECT day,
		       COUNT(*)            AS workouts,
		       SUM(duration)       AS duration,
		       SUM(volume)         AS volume,
		       SUM(sets_count)     AS sets_count,
		       SUM(exercise_count) AS exercise_count
		FROM (
			SELECT `+dayExpr+` AS day,
			       w.duration AS duration,
			       COALESCE((SELECT SUM(s.reps * s.weight)
			                   FROM sets s
			                   JOIN workout_exercises we ON we.id = s.workout_exercise_id
			                  WHERE we.workout_id = w.id AND `+completedWorkingSets+`), 0) AS volume,
			       COALESCE((SELECT COUNT(*)
			                   FROM sets s
			                   JOIN workout_exercises we ON we.id = s.workout_exercise_id
			                  WHERE we.workout_id = w.id AND `+completedWorkingSets+`), 0) AS sets_count,
			       COALESCE((SELECT COUNT(*)
			                   FROM workout_exercises we
			                  WHERE we.workout_id = w.id), 0) AS exercise_count
			  FROM workouts w
			 WHERE w.user_id = ?2
			   AND `+dayExpr+` BETWEEN ?3 AND ?4
		)
		GROUP BY day
		ORDER BY day ASC
	`, tzModifier(tzOffset), uid, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	days := []TrainingDay{}
	for rows.Next() {
		var d TrainingDay
		if err := rows.Scan(&d.Date, &d.Workouts, &d.Duration, &d.Volume, &d.Sets, &d.Exercises); err != nil {
			return nil, err
		}
		days = append(days, d)
	}
	return days, rows.Err()
}

// TrainingMuscles returns per-muscle-group totals over [from, to], including
// every muscle group in the exercise library that the user did NOT train.
//
// The zero-fill comes from LEFT JOINing the library's distinct muscle groups
// onto the user's totals. last_trained is computed over unbounded history via
// conditional aggregation, so it needs no second query and no correlated
// subquery per muscle.
func (s *WorkoutStore) TrainingMuscles(uid int64, from, to string, tzOffset int) ([]MuscleTotal, error) {
	rows, err := s.db.Query(`
		SELECT mg.muscle_group,
		       COALESCE(t.sets_count, 0),
		       COALESCE(t.volume, 0),
		       COALESCE(t.reps, 0),
		       COALESCE(t.workouts, 0),
		       COALESCE(t.last_trained, '')
		FROM (SELECT DISTINCT muscle_group FROM exercises WHERE muscle_group <> '') mg
		LEFT JOIN (
			SELECT e.muscle_group AS muscle_group,
			       SUM(CASE WHEN d.day BETWEEN ?2 AND ?3 THEN 1 ELSE 0 END)                 AS sets_count,
			       SUM(CASE WHEN d.day BETWEEN ?2 AND ?3 THEN d.reps * d.weight ELSE 0 END) AS volume,
			       SUM(CASE WHEN d.day BETWEEN ?2 AND ?3 THEN d.reps ELSE 0 END)            AS reps,
			       COUNT(DISTINCT CASE WHEN d.day BETWEEN ?2 AND ?3 THEN d.wid END)         AS workouts,
			       MAX(d.day)                                                               AS last_trained
			  FROM (
				SELECT w.id AS wid, we.exercise_id AS exercise_id,
				       s.reps AS reps, s.weight AS weight,
				       `+dayExpr+` AS day
				  FROM sets s
				  JOIN workout_exercises we ON we.id = s.workout_exercise_id
				  JOIN workouts w          ON w.id  = we.workout_id
				 WHERE w.user_id = ?4 AND `+completedWorkingSets+`
			  ) d
			  JOIN exercises e ON e.id = d.exercise_id
			 GROUP BY e.muscle_group
		) t ON t.muscle_group = mg.muscle_group
		ORDER BY sets_count DESC, mg.muscle_group ASC
	`, tzModifier(tzOffset), from, to, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	muscles := []MuscleTotal{}
	for rows.Next() {
		var m MuscleTotal
		if err := rows.Scan(&m.MuscleGroup, &m.Sets, &m.Volume, &m.Reps, &m.Workouts, &m.LastTrained); err != nil {
			return nil, err
		}
		muscles = append(muscles, m)
	}
	return muscles, rows.Err()
}

// TrainingStreakFor returns the current and longest run of consecutive training
// days, over the user's whole history (a streak is not a windowed concept).
//
// Gaps-and-islands: subtracting a dense row number from each date's julian day
// yields a constant per consecutive run, so grouping by it counts the runs.
// modernc.org/sqlite supports window functions, so this is one query.
//
// `today` is the user's LOCAL date. A run ending yesterday still counts as
// current — the day isn't over, and telling someone their 40-day streak died at
// 00:01 is both wrong and the fastest way to make them stop trusting the number.
func (s *WorkoutStore) TrainingStreakFor(uid int64, today string, tzOffset int) (TrainingStreak, error) {
	var st TrainingStreak
	err := s.db.QueryRow(`
		WITH days AS (
			SELECT DISTINCT `+dayExpr+` AS day
			  FROM workouts w
			 WHERE w.user_id = ?2
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

// LocalToday returns the user's current calendar date for the given UTC offset.
func LocalToday(tzOffset int) string {
	if tzOffset < -720 {
		tzOffset = -720
	}
	if tzOffset > 840 {
		tzOffset = 840
	}
	return time.Now().UTC().Add(time.Duration(tzOffset) * time.Minute).Format("2006-01-02")
}
