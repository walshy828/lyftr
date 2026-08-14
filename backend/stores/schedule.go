package stores

import (
	"database/sql"
	"time"
)

// ScheduleStore owns the weekly training plan: which programs sit on which
// weekday, plus one-off date overrides.
type ScheduleStore struct{ db *sql.DB }

func NewScheduleStore(db *sql.DB) *ScheduleStore { return &ScheduleStore{db: db} }

// ScheduledProgram is one program's slot on a day.
type ScheduledProgram struct {
	ProgramID     int64  `json:"program_id"`
	Name          string `json:"name"`
	ExerciseCount int    `json:"exercise_count"`
	OrderIndex    int    `json:"order_index"`
	// CompletedWorkoutID is set when a workout for this program was already
	// logged on this date, so the UI can show "done" instead of prompting a
	// duplicate session.
	CompletedWorkoutID *int64 `json:"completed_workout_id,omitempty"`
}

// ScheduleSource records why a day looks the way it does. The distinction is
// user-visible: an overridden day should be able to say "moved" and offer to
// revert to the pattern.
type ScheduleSource string

const (
	SourceRecurring ScheduleSource = "recurring"
	SourceOverride  ScheduleSource = "override"
	SourceRest      ScheduleSource = "rest"
)

// ScheduledDay is one resolved calendar day.
type ScheduledDay struct {
	Date     string             `json:"date"`
	Weekday  int                `json:"weekday"`
	Source   ScheduleSource     `json:"source"`
	Programs []ScheduledProgram `json:"programs"`
}

// recurringRow / overrideRow are the raw table shapes before resolution.
type recurringRow struct {
	Weekday    int
	ProgramID  int64
	Name       string
	Exercises  int
	OrderIndex int
}

// Recurring returns the whole weekly pattern (at most a handful of rows).
func (s *ScheduleStore) Recurring(uid int64) (map[int][]ScheduledProgram, error) {
	rows, err := s.db.Query(`
		SELECT ps.weekday, ps.program_id, p.name, ps.order_index,
		       (SELECT COUNT(*) FROM program_exercises pe WHERE pe.program_id = p.id)
		  FROM program_schedules ps
		  JOIN programs p ON p.id = ps.program_id
		 WHERE ps.user_id = ?
		 ORDER BY ps.weekday, ps.order_index, p.name
	`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[int][]ScheduledProgram{}
	for rows.Next() {
		var r recurringRow
		if err := rows.Scan(&r.Weekday, &r.ProgramID, &r.Name, &r.OrderIndex, &r.Exercises); err != nil {
			return nil, err
		}
		out[r.Weekday] = append(out[r.Weekday], ScheduledProgram{
			ProgramID: r.ProgramID, Name: r.Name, ExerciseCount: r.Exercises, OrderIndex: r.OrderIndex,
		})
	}
	return out, rows.Err()
}

// overridesBetween returns override rows for [from, to]. A date present in the
// map with an empty slice is an explicit rest day — which is why this returns a
// map with explicit keys rather than only non-empty entries.
func (s *ScheduleStore) overridesBetween(uid int64, from, to string) (map[string][]ScheduledProgram, error) {
	rows, err := s.db.Query(`
		SELECT o.on_date, o.program_id, COALESCE(p.name, ''), o.order_index,
		       COALESCE((SELECT COUNT(*) FROM program_exercises pe WHERE pe.program_id = o.program_id), 0)
		  FROM program_schedule_overrides o
		  LEFT JOIN programs p ON p.id = o.program_id
		 WHERE o.user_id = ? AND o.on_date BETWEEN ? AND ?
		 ORDER BY o.on_date, o.order_index, p.name
	`, uid, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][]ScheduledProgram{}
	for rows.Next() {
		var date string
		var programID sql.NullInt64
		var name string
		var orderIndex, exercises int
		if err := rows.Scan(&date, &programID, &name, &orderIndex, &exercises); err != nil {
			return nil, err
		}
		if _, ok := out[date]; !ok {
			out[date] = []ScheduledProgram{}
		}
		// A NULL program_id is the rest marker: the date is present, the list
		// stays empty.
		if programID.Valid {
			out[date] = append(out[date], ScheduledProgram{
				ProgramID: programID.Int64, Name: name, ExerciseCount: exercises, OrderIndex: orderIndex,
			})
		}
	}
	return out, rows.Err()
}

// completedBetween maps a local date to the program workouts logged on it, so a
// resolved day can be marked done. Uses the same mixed-format-tolerant day
// bucketing as the training stats.
func (s *ScheduleStore) completedBetween(uid int64, from, to string, tzOffset int) (map[string]map[int64]int64, error) {
	rows, err := s.db.Query(`
		SELECT `+dayExpr+` AS day, w.program_id, w.id
		  FROM workouts w
		 WHERE w.user_id = ?2
		   AND w.program_id IS NOT NULL
		   AND `+dayExpr+` BETWEEN ?3 AND ?4
	`, tzModifier(tzOffset), uid, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]map[int64]int64{}
	for rows.Next() {
		var day string
		var programID, workoutID int64
		if err := rows.Scan(&day, &programID, &workoutID); err != nil {
			return nil, err
		}
		if out[day] == nil {
			out[day] = map[int64]int64{}
		}
		out[day][programID] = workoutID
	}
	return out, rows.Err()
}

// Resolve returns the schedule for every date in [from, to].
//
// The whole design in one sentence: if a date has any override rows, those rows
// ARE that day's programs (a lone rest marker yields an empty list); otherwise
// the recurring rows for that weekday.
//
// Two queries regardless of range length, plus one for completion.
func (s *ScheduleStore) Resolve(uid int64, from, to string, tzOffset int) ([]ScheduledDay, error) {
	recurring, err := s.Recurring(uid)
	if err != nil {
		return nil, err
	}
	overrides, err := s.overridesBetween(uid, from, to)
	if err != nil {
		return nil, err
	}
	completed, err := s.completedBetween(uid, from, to, tzOffset)
	if err != nil {
		return nil, err
	}

	start, err := time.Parse("2006-01-02", from)
	if err != nil {
		return nil, err
	}
	end, err := time.Parse("2006-01-02", to)
	if err != nil {
		return nil, err
	}

	days := []ScheduledDay{}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		date := d.Format("2006-01-02")
		weekday := int(d.Weekday())

		var programs []ScheduledProgram
		source := SourceRecurring
		if ov, ok := overrides[date]; ok {
			programs = ov
			source = SourceOverride
			if len(ov) == 0 {
				source = SourceRest
			}
		} else {
			programs = append(programs, recurring[weekday]...)
			if len(programs) == 0 {
				source = SourceRest
			}
		}

		// Mark anything already logged. Copied per-day rather than mutated in
		// place because the recurring slice is shared across every occurrence
		// of that weekday in the range.
		if done := completed[date]; len(done) > 0 {
			marked := make([]ScheduledProgram, len(programs))
			for i, p := range programs {
				if wid, ok := done[p.ProgramID]; ok {
					id := wid
					p.CompletedWorkoutID = &id
				}
				marked[i] = p
			}
			programs = marked
		}

		if programs == nil {
			programs = []ScheduledProgram{}
		}
		days = append(days, ScheduledDay{Date: date, Weekday: weekday, Source: source, Programs: programs})
	}
	return days, nil
}

// ReplaceRecurring swaps the user's entire weekly pattern in one transaction.
//
// A full replace rather than a diff: it is idempotent, has no partial-update
// semantics to get wrong, and matches how WorkoutStore.Update replaces a
// workout's children. The pattern is at most a few dozen rows.
func (s *ScheduleStore) ReplaceRecurring(uid int64, days map[int][]int64) error {
	return inTxDo(s.db, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM program_schedules WHERE user_id = ?`, uid); err != nil {
			return err
		}
		stmt, err := tx.Prepare(`INSERT INTO program_schedules (user_id, program_id, weekday, order_index) VALUES (?, ?, ?, ?)`)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for weekday, programIDs := range days {
			for i, pid := range programIDs {
				if _, err := stmt.Exec(uid, pid, weekday, i); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// SetOverride replaces every override row for one date. An empty programIDs
// slice writes a single NULL row, which is the explicit "rest day" marker.
func (s *ScheduleStore) SetOverride(uid int64, date string, programIDs []int64) error {
	return inTxDo(s.db, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM program_schedule_overrides WHERE user_id = ? AND on_date = ?`, uid, date); err != nil {
			return err
		}
		if len(programIDs) == 0 {
			_, err := tx.Exec(`INSERT INTO program_schedule_overrides (user_id, on_date, program_id, order_index) VALUES (?, ?, NULL, 0)`, uid, date)
			return err
		}
		stmt, err := tx.Prepare(`INSERT INTO program_schedule_overrides (user_id, on_date, program_id, order_index) VALUES (?, ?, ?, ?)`)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for i, pid := range programIDs {
			if _, err := stmt.Exec(uid, date, pid, i); err != nil {
				return err
			}
		}
		return nil
	})
}

// ClearOverride reverts a date to the recurring pattern.
func (s *ScheduleStore) ClearOverride(uid int64, date string) error {
	_, err := s.db.Exec(`DELETE FROM program_schedule_overrides WHERE user_id = ? AND on_date = ?`, uid, date)
	return err
}
