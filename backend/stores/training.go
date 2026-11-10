package stores

import (
	"database/sql"
	"sort"
	"strings"
)

// Training types ("modalities").
//
// Three things get a type, at three levels:
//   - exercises.modality: what a single movement is — strength, cardio or
//     mobility (stretching). Inferred once, overridable library-wide.
//   - programs.kind: what a routine is. Suggested from its exercises when
//     left blank; the user's choice wins.
//   - workouts.kind: what a logged session counted as. Copied from its
//     routine, or inferred from its exercises for a freestyle session.
//
// Watch-synced cardio_sessions carry no column: they are always cardio.
//
// Why exercises need their own column rather than reading `category`: on the
// free-exercise-db library `category` is a real type ("stretching",
// "cardio", ...), but on the Gymvisual library it holds the BODY PART
// ("upper legs", "waist"), so a hamstring stretch reads as "upper legs".
// modality is the one field every library agrees on.
const (
	ModalityStrength = "strength"
	ModalityCardio   = "cardio"
	ModalityMobility = "mobility"
	KindMixed        = "mixed"
)

// ValidModality reports whether m is a per-exercise type.
func ValidModality(m string) bool {
	return m == ModalityStrength || m == ModalityCardio || m == ModalityMobility
}

// ValidKind reports whether k is a routine/workout type (empty means "infer").
func ValidKind(k string) bool {
	return ValidModality(k) || k == KindMixed
}

// modalityInferSQL is the inference rule as a SQL CASE over the exercises
// table, so the boot backfill is one UPDATE instead of a loop over ~900 rows.
// InferModality below is the same rule in Go — keep them in step (a test
// checks they agree).
const modalityInferSQL = `CASE
	WHEN LOWER(category) = 'cardio' OR source = 'baseline' THEN 'cardio'
	WHEN LOWER(category) IN ('stretching', 'flexibility', 'mobility')
	  OR LOWER(name) LIKE '%stretch%' OR LOWER(name) LIKE '%yoga%'
	  OR LOWER(name) LIKE '% pose%'   OR LOWER(name) LIKE '%mobility%'
	  OR LOWER(name) LIKE '%foam roll%' THEN 'mobility'
	ELSE 'strength' END`

// InferModality classifies one exercise by its library category and name.
func InferModality(category, source, name string) string {
	c, n := strings.ToLower(category), strings.ToLower(name)
	switch {
	case c == "cardio" || source == "baseline":
		return ModalityCardio
	case c == "stretching" || c == "flexibility" || c == "mobility",
		strings.Contains(n, "stretch"), strings.Contains(n, "yoga"),
		strings.Contains(n, " pose"), strings.Contains(n, "mobility"),
		strings.Contains(n, "foam roll"):
		return ModalityMobility
	}
	return ModalityStrength
}

// InferKind turns a routine's/workout's per-modality exercise counts into a
// kind: a clear majority (≥60%) names it, anything flatter is "mixed". The
// threshold exists so a lifting day with one cool-down stretch is still a
// lifting day, while a genuine half-and-half session isn't forced into one.
// No exercises at all reads as strength — the app's historical default.
func InferKind(counts map[string]int) string {
	total, top, topN := 0, ModalityStrength, 0
	for _, m := range []string{ModalityStrength, ModalityCardio, ModalityMobility} {
		n := counts[m]
		total += n
		if n > topN {
			top, topN = m, n
		}
	}
	if total == 0 {
		return ModalityStrength
	}
	if float64(topN)/float64(total) >= 0.6 {
		return top
	}
	return KindMixed
}

// TrainingStore owns training-type bookkeeping: the backfill, per-type weekly
// goals, and the per-day/per-type rollup the Train hub and stats read.
type TrainingStore struct{ db *sql.DB }

func NewTrainingStore(db *sql.DB) *TrainingStore { return &TrainingStore{db: db} }

// Backfill fills every blank modality/kind. Idempotent and cheap once done
// (each statement only touches rows still blank), so it runs on every boot and
// after each exercise-library sync, which inserts rows with a blank modality.
// Order matters: exercises first, since routine/workout kinds read them.
func (s *TrainingStore) Backfill() error {
	if _, err := s.db.Exec(`UPDATE exercises SET modality = ` + modalityInferSQL + ` WHERE modality = ''`); err != nil {
		return err
	}
	if err := s.backfillKinds("programs", "program_exercises", "program_id"); err != nil {
		return err
	}
	// A workout started from a routine inherits that routine's kind; only
	// freestyle sessions (or ones whose routine was deleted) infer.
	if _, err := s.db.Exec(`
		UPDATE workouts SET kind = (SELECT p.kind FROM programs p WHERE p.id = workouts.program_id)
		 WHERE kind = '' AND program_id IS NOT NULL
		   AND EXISTS (SELECT 1 FROM programs p WHERE p.id = workouts.program_id AND p.kind <> '')`); err != nil {
		return err
	}
	return s.backfillKinds("workouts", "workout_exercises", "workout_id")
}

// backfillKinds infers kind for every row of parent with a blank kind. The table
// names are compile-time constants from Backfill, never user input.
func (s *TrainingStore) backfillKinds(parent, child, fk string) error {
	rows, err := s.db.Query(`
		SELECT p.id, COALESCE(e.modality, ''), COUNT(e.id)
		  FROM ` + parent + ` p
		  LEFT JOIN ` + child + ` c ON c.` + fk + ` = p.id
		  LEFT JOIN exercises e ON e.id = c.exercise_id
		 WHERE p.kind = ''
		 GROUP BY p.id, e.modality`)
	if err != nil {
		return err
	}
	counts := map[int64]map[string]int{}
	for rows.Next() {
		var id int64
		var m string
		var n int
		if err := rows.Scan(&id, &m, &n); err != nil {
			rows.Close()
			return err
		}
		if counts[id] == nil {
			counts[id] = map[string]int{}
		}
		counts[id][m] += n
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close() // one connection: release the cursor before writing

	if len(counts) == 0 {
		return nil
	}
	return inTxDo(s.db, func(tx *sql.Tx) error {
		stmt, err := tx.Prepare(`UPDATE ` + parent + ` SET kind = ? WHERE id = ?`)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for id, c := range counts {
			if _, err := stmt.Exec(InferKind(c), id); err != nil {
				return err
			}
		}
		return nil
	})
}

// inferKindForExercises infers a kind from exercise ids inside a write tx, for
// a create/update that didn't say what it is.
func inferKindForExercises(tx *sql.Tx, ids []int64) (string, error) {
	if len(ids) == 0 {
		return ModalityStrength, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	// Distinct exercises (IN dedupes), which is what "what is this routine
	// made of" means. An exercise whose modality is still '' (inserted by a
	// library sync since the last backfill) is inferred on the spot.
	rows, err := tx.Query(`SELECT modality, category, source, name FROM exercises WHERE id IN (`+ph+`)`, args...)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var m, cat, src, name string
		if err := rows.Scan(&m, &cat, &src, &name); err != nil {
			return "", err
		}
		if m == "" {
			m = InferModality(cat, src, name)
		}
		counts[m]++
	}
	return InferKind(counts), rows.Err()
}

// ── Goals ────────────────────────────────────────────────────────────────

// TrainingGoal is one type's weekly target. Either field may be 0 (= no
// target on that axis): cardio is naturally a minutes goal, strength a days
// goal, mobility often both.
type TrainingGoal struct {
	Kind           string `json:"kind"`
	DaysPerWeek    int    `json:"days_per_week"`
	MinutesPerWeek int    `json:"minutes_per_week"`
}

// DefaultTrainingGoals is what a user who never set goals sees: roughly the
// common public-health guidance (strength 2+ days covering major muscle
// groups, ~150 min moderate cardio, stretching most days), nudged to the
// 3-strength-day split the app's schedule is built around.
var DefaultTrainingGoals = []TrainingGoal{
	{Kind: ModalityStrength, DaysPerWeek: 3},
	{Kind: ModalityCardio, DaysPerWeek: 3, MinutesPerWeek: 150},
	{Kind: ModalityMobility, DaysPerWeek: 5, MinutesPerWeek: 50},
}

// Goals returns the user's goals for all three types, falling back to the
// default for any type without a saved row. Always strength, cardio, mobility
// in that order.
func (s *TrainingStore) Goals(uid int64) ([]TrainingGoal, error) {
	rows, err := s.db.Query(`SELECT kind, days_per_week, minutes_per_week FROM training_goals WHERE user_id = ?`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	saved := map[string]TrainingGoal{}
	for rows.Next() {
		var g TrainingGoal
		if err := rows.Scan(&g.Kind, &g.DaysPerWeek, &g.MinutesPerWeek); err != nil {
			return nil, err
		}
		saved[g.Kind] = g
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]TrainingGoal, 0, len(DefaultTrainingGoals))
	for _, d := range DefaultTrainingGoals {
		if g, ok := saved[d.Kind]; ok {
			out = append(out, g)
		} else {
			out = append(out, d)
		}
	}
	return out, nil
}

// SetGoals upserts the given goals (any subset of the three types).
func (s *TrainingStore) SetGoals(uid int64, goals []TrainingGoal) ([]TrainingGoal, error) {
	if err := inTxDo(s.db, func(tx *sql.Tx) error {
		for _, g := range goals {
			if _, err := tx.Exec(`
				INSERT INTO training_goals (user_id, kind, days_per_week, minutes_per_week) VALUES (?, ?, ?, ?)
				ON CONFLICT(user_id, kind) DO UPDATE SET days_per_week = excluded.days_per_week,
				                                         minutes_per_week = excluded.minutes_per_week`,
				uid, g.Kind, g.DaysPerWeek, g.MinutesPerWeek); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.Goals(uid)
}

// ── Per-day rollup ───────────────────────────────────────────────────────

// KindTotals is one type's activity on one day.
type KindTotals struct {
	Sessions int `json:"sessions"`
	Minutes  int `json:"minutes"`
}

// TrainingTypeDay is one local calendar day split by type. Days with nothing
// are omitted, like TrainingDay.
type TrainingTypeDay struct {
	Date     string     `json:"date"`
	Strength KindTotals `json:"strength"`
	Cardio   KindTotals `json:"cardio"`
	Mobility KindTotals `json:"mobility"`
}

func (d *TrainingTypeDay) slot(m string) *KindTotals {
	switch m {
	case ModalityCardio:
		return &d.Cardio
	case ModalityMobility:
		return &d.Mobility
	}
	return &d.Strength
}

// TypeDays returns per-day, per-type sessions and minutes over [from, to],
// merging logged workouts with watch-synced cardio.
//
// A mixed workout counts as a session for every type it contains, and its
// minutes are split across those types by exercise count — so a 60-minute
// session of 6 lifts and 2 stretches is 45 strength minutes and 15 mobility
// minutes, and the week's minutes still add up to time actually spent.
func (s *TrainingStore) TypeDays(uid int64, from, to string, tzOffset int) ([]TrainingTypeDay, error) {
	days := map[string]*TrainingTypeDay{}
	get := func(date string) *TrainingTypeDay {
		if d, ok := days[date]; ok {
			return d
		}
		d := &TrainingTypeDay{Date: date}
		days[date] = d
		return d
	}

	// One row per (workout, exercise modality). LEFT JOIN so an exercise-less
	// workout still appears (modality NULL → it counts under its own kind).
	rows, err := s.db.Query(`
		SELECT w.id, `+dayExpr+` AS day, w.kind, w.duration, e.modality, COUNT(e.id)
		  FROM workouts w
		  LEFT JOIN workout_exercises we ON we.workout_id = w.id
		  LEFT JOIN exercises e ON e.id = we.exercise_id
		 WHERE w.user_id = ?2
		   AND `+dayExpr+` BETWEEN ?3 AND ?4
		 GROUP BY w.id, e.modality
	`, tzModifier(tzOffset), uid, from, to)
	if err != nil {
		return nil, err
	}
	type wk struct {
		day, kind string
		duration  int
		counts    map[string]int
	}
	workouts := map[int64]*wk{}
	order := []int64{}
	for rows.Next() {
		var id int64
		var day, kind string
		var duration, n int
		var modality sql.NullString
		if err := rows.Scan(&id, &day, &kind, &duration, &modality, &n); err != nil {
			rows.Close()
			return nil, err
		}
		w, ok := workouts[id]
		if !ok {
			w = &wk{day: day, kind: kind, duration: duration, counts: map[string]int{}}
			workouts[id] = w
			order = append(order, id)
		}
		if modality.Valid && modality.String != "" {
			w.counts[modality.String] += n
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	for _, id := range order {
		w := workouts[id]
		d := get(w.day)
		mins := (w.duration + 30) / 60
		if w.kind != KindMixed {
			k := w.kind
			if !ValidModality(k) {
				k = InferKind(w.counts)
			}
			if k != KindMixed {
				sl := d.slot(k)
				sl.Sessions++
				sl.Minutes += mins
				continue
			}
		}
		total := 0
		for _, n := range w.counts {
			total += n
		}
		if total == 0 { // mixed but empty: nothing to split by
			d.Strength.Sessions++
			d.Strength.Minutes += mins
			continue
		}
		for _, m := range []string{ModalityStrength, ModalityCardio, ModalityMobility} {
			if n := w.counts[m]; n > 0 {
				sl := d.slot(m)
				sl.Sessions++
				sl.Minutes += mins * n / total
			}
		}
	}

	crows, err := s.db.Query(`
		SELECT `+cardioDayExpr+` AS day, COUNT(*), COALESCE(SUM(c.duration_seconds), 0)
		  FROM cardio_sessions c
		 WHERE c.user_id = ?2
		   AND `+cardioDayExpr+` BETWEEN ?3 AND ?4
		 GROUP BY day
	`, tzModifier(tzOffset), uid, from, to)
	if err != nil {
		return nil, err
	}
	defer crows.Close()
	for crows.Next() {
		var day string
		var n, secs int
		if err := crows.Scan(&day, &n, &secs); err != nil {
			return nil, err
		}
		d := get(day)
		d.Cardio.Sessions += n
		d.Cardio.Minutes += (secs + 30) / 60
	}
	if err := crows.Err(); err != nil {
		return nil, err
	}

	out := make([]TrainingTypeDay, 0, len(days))
	for _, d := range days {
		out = append(out, *d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	return out, nil
}
