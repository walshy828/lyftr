package stores

import (
	"database/sql"
	"strings"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// ProgramStore owns all SQL for programs, program_exercises and program_sets.
type ProgramStore struct{ db *sql.DB }

func NewProgramStore(db *sql.DB) *ProgramStore { return &ProgramStore{db: db} }

// ProgramFilter holds list paging + optional name search/sort.
type ProgramFilter struct {
	Limit, Offset int
	Query         string
	Sort          string // "name" | "created" | "smart" (default: last-used desc, then created desc)
}

const programCols = `id, user_id, name, notes, is_shared, created_at`

// lastUsedJoin attaches each program's most recent workout start time (NULL if
// the program has never been used), for "smart" sorting and display.
const lastUsedJoin = `LEFT JOIN (
	SELECT program_id, MAX(started_at) AS last_used_at FROM workouts WHERE program_id IS NOT NULL GROUP BY program_id
) lu ON lu.program_id = p.id`

// programOrderClause maps a ProgramFilter.Sort value to a whitelisted ORDER BY
// fragment — never interpolate user input directly into ORDER BY.
func programOrderClause(sort string) string {
	switch sort {
	case "name":
		return `ORDER BY LOWER(p.name) ASC`
	case "created":
		return `ORDER BY p.created_at DESC`
	default: // "smart": most-recently-used first, unused programs last, then newest first
		return `ORDER BY (lu.last_used_at IS NULL) ASC, lu.last_used_at DESC, p.created_at DESC`
	}
}

func scanProgram(row interface{ Scan(...any) error }, p *models.Program) error {
	return row.Scan(&p.ID, &p.UserID, &p.Name, &p.Notes, &p.IsShared, &p.CreatedAt)
}

// lastUsedLayouts are the datetime formats that may show up in
// workouts.started_at: RFC3339 (written by the app via a bound time.Time
// parameter), SQLite's own CURRENT_TIMESTAMP default format, and Go's
// time.Time.String() format (older rows written via an interpolated/%v
// value instead of a proper driver.Valuer binding).
var lastUsedLayouts = []string{
	time.RFC3339,
	"2006-01-02 15:04:05",
	"2006-01-02 15:04:05.999999999 -0700 MST",
}

// parseLastUsed converts the lastUsedJoin's MAX(started_at) result to a
// *time.Time. It comes back as a plain string rather than a driver-typed
// time.Time because SQLite aggregate expressions lose the column's declared
// type affinity, so sql.NullTime can't scan it directly. last_used_at is
// display/sort metadata, not core data — an unrecognized historical format
// degrades to "unknown" (nil) rather than 500ing the whole programs list.
func parseLastUsed(ns sql.NullString) *time.Time {
	if !ns.Valid {
		return nil
	}
	for _, layout := range lastUsedLayouts {
		if t, err := time.Parse(layout, ns.String); err == nil {
			return &t
		}
	}
	return nil
}

func (s *ProgramStore) List(uid int64, f ProgramFilter) ([]models.Program, error) {
	base := `SELECT p.id, p.user_id, p.name, p.notes, p.is_shared, p.created_at, lu.last_used_at
	         FROM programs p ` + lastUsedJoin + `
	         WHERE p.user_id = ?`
	order := programOrderClause(f.Sort)
	var rows *sql.Rows
	var err error
	if f.Query != "" {
		rows, err = s.db.Query(
			base+` AND LOWER(p.name) LIKE ? `+order+` LIMIT ? OFFSET ?`,
			uid, "%"+strings.ToLower(f.Query)+"%", f.Limit, f.Offset,
		)
	} else {
		rows, err = s.db.Query(
			base+` `+order+` LIMIT ? OFFSET ?`,
			uid, f.Limit, f.Offset,
		)
	}
	if err != nil {
		return nil, err
	}
	programs := []models.Program{}
	for rows.Next() {
		var p models.Program
		var lastUsed sql.NullString
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Notes, &p.IsShared, &p.CreatedAt, &lastUsed); err != nil {
			rows.Close()
			return nil, err
		}
		p.LastUsedAt = parseLastUsed(lastUsed)
		programs = append(programs, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close() // close the parent cursor BEFORE loading children (#36)

	if err := s.attachExercises(programs); err != nil {
		return nil, err
	}
	return programs, nil
}

// Get returns a program the caller owns, or any program that's shared, along
// with its exercises/sets, or sql.ErrNoRows if neither applies. OwnerEmail is
// populated only when the caller isn't the owner, for shared-program attribution.
func (s *ProgramStore) Get(uid, id int64) (models.Program, error) {
	var p models.Program
	var ownerEmail sql.NullString
	err := s.db.QueryRow(
		`SELECT p.id, p.user_id, p.name, p.notes, p.is_shared, p.created_at,
		        CASE WHEN p.user_id != ? THEN u.email ELSE NULL END
		 FROM programs p JOIN users u ON u.id = p.user_id
		 WHERE p.id = ? AND (p.user_id = ? OR p.is_shared = 1)`,
		uid, id, uid,
	).Scan(&p.ID, &p.UserID, &p.Name, &p.Notes, &p.IsShared, &p.CreatedAt, &ownerEmail)
	if err != nil {
		return models.Program{}, err
	}
	if ownerEmail.Valid {
		p.OwnerEmail = ownerEmail.String
	}
	ex, err := s.loadExercises(id)
	if err != nil {
		return models.Program{}, err
	}
	p.Exercises = ex
	return p, nil
}

// ListShared returns other users' shared programs, newest first, with the
// owner's email attached for attribution. Excludes the caller's own programs
// (even if shared) since those already appear under "My Programs".
func (s *ProgramStore) ListShared(uid int64, f ProgramFilter) ([]models.Program, error) {
	var rows *sql.Rows
	var err error
	base := `SELECT p.id, p.user_id, p.name, p.notes, p.is_shared, p.created_at, u.email, lu.last_used_at
	         FROM programs p JOIN users u ON u.id = p.user_id ` + lastUsedJoin + `
	         WHERE p.is_shared = 1 AND p.user_id != ?`
	order := programOrderClause(f.Sort)
	if f.Query != "" {
		rows, err = s.db.Query(base+` AND LOWER(p.name) LIKE ? `+order+` LIMIT ? OFFSET ?`,
			uid, "%"+strings.ToLower(f.Query)+"%", f.Limit, f.Offset)
	} else {
		rows, err = s.db.Query(base+` `+order+` LIMIT ? OFFSET ?`, uid, f.Limit, f.Offset)
	}
	if err != nil {
		return nil, err
	}
	programs := []models.Program{}
	for rows.Next() {
		var p models.Program
		var ownerEmail string
		var lastUsed sql.NullString
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Notes, &p.IsShared, &p.CreatedAt, &ownerEmail, &lastUsed); err != nil {
			rows.Close()
			return nil, err
		}
		p.OwnerEmail = ownerEmail
		p.LastUsedAt = parseLastUsed(lastUsed)
		programs = append(programs, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	if err := s.attachExercises(programs); err != nil {
		return nil, err
	}
	return programs, nil
}

// SetShared flips is_shared for a program the caller owns. Returns
// sql.ErrNoRows if the program doesn't exist or isn't theirs.
func (s *ProgramStore) SetShared(uid, id int64, shared bool) (models.Program, error) {
	res, err := s.db.Exec(`UPDATE programs SET is_shared = ? WHERE id = ? AND user_id = ?`, shared, id, uid)
	if err != nil {
		return models.Program{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return models.Program{}, err
	}
	if n == 0 {
		return models.Program{}, sql.ErrNoRows
	}
	return s.Get(uid, id)
}

// Copy creates an independent copy of program srcID (which must be owned by
// uid or currently shared) under uid's own account. The copy is never itself
// shared and carries no link back to the source — it's a fully independent
// template so the copier can set their own target weights.
func (s *ProgramStore) Copy(uid, srcID int64) (models.Program, error) {
	src, err := s.Get(uid, srcID)
	if err != nil {
		return models.Program{}, err
	}
	req := models.CreateProgramRequest{
		Name:  src.Name + " (Copy)",
		Notes: src.Notes,
	}
	for _, ex := range src.Exercises {
		cex := models.CreateProgramExerciseReq{
			ExerciseID:  ex.ExerciseID,
			Notes:       ex.Notes,
			RestSeconds: ex.RestSeconds,
		}
		for _, st := range ex.Sets {
			cex.Sets = append(cex.Sets, models.CreateProgramSetReq{
				SetNumber:    st.SetNumber,
				TargetReps:   st.TargetReps,
				TargetWeight: st.TargetWeight,
			})
		}
		req.Exercises = append(req.Exercises, cex)
	}
	return s.Create(uid, req)
}

func (s *ProgramStore) get(id int64) (models.Program, error) {
	var p models.Program
	if err := scanProgram(s.db.QueryRow(`SELECT `+programCols+` FROM programs WHERE id = ?`, id), &p); err != nil {
		return models.Program{}, err
	}
	ex, err := s.loadExercises(id)
	if err != nil {
		return models.Program{}, err
	}
	p.Exercises = ex
	return p, nil
}

func (s *ProgramStore) Create(uid int64, req models.CreateProgramRequest) (models.Program, error) {
	pid, err := inTx(s.db, func(tx *sql.Tx) (int64, error) {
		res, err := tx.Exec(`INSERT INTO programs (user_id, name, notes) VALUES (?, ?, ?)`, uid, req.Name, req.Notes)
		if err != nil {
			return 0, err
		}
		pid, err := res.LastInsertId()
		if err != nil {
			return 0, err
		}
		if err := insertProgramExercises(tx, pid, req.Exercises); err != nil {
			return 0, err
		}
		return pid, nil
	})
	if err != nil {
		return models.Program{}, err
	}
	return s.get(pid)
}

// Update replaces a user-owned program and its children in one tx. sql.ErrNoRows
// if the program isn't theirs (nothing is mutated).
func (s *ProgramStore) Update(uid, id int64, req models.CreateProgramRequest) (models.Program, error) {
	if err := inTxDo(s.db, func(tx *sql.Tx) error {
		var ownedID int64
		if err := tx.QueryRow(`SELECT id FROM programs WHERE id = ? AND user_id = ?`, id, uid).Scan(&ownedID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE programs SET name = ?, notes = ? WHERE id = ?`, req.Name, req.Notes, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM program_exercises WHERE program_id = ?`, id); err != nil {
			return err
		}
		return insertProgramExercises(tx, id, req.Exercises)
	}); err != nil {
		return models.Program{}, err
	}
	return s.get(id)
}

func (s *ProgramStore) Delete(uid, id int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM programs WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func insertProgramExercises(tx *sql.Tx, pid int64, exercises []models.CreateProgramExerciseReq) error {
	for i, ex := range exercises {
		exRes, err := tx.Exec(
			`INSERT INTO program_exercises (program_id, exercise_id, order_index, notes, rest_seconds) VALUES (?, ?, ?, ?, ?)`,
			pid, ex.ExerciseID, i, ex.Notes, ex.RestSeconds,
		)
		if err != nil {
			return err
		}
		peid, err := exRes.LastInsertId()
		if err != nil {
			return err
		}
		for j, st := range ex.Sets {
			sn := st.SetNumber
			if sn == 0 {
				sn = j + 1
			}
			if _, err := tx.Exec(
				`INSERT INTO program_sets (program_exercise_id, set_number, target_reps, target_weight) VALUES (?, ?, ?, ?)`,
				peid, sn, st.TargetReps, st.TargetWeight,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

// loadExercises loads one program's exercises + sets (single-item Get paths).
func (s *ProgramStore) loadExercises(programID int64) ([]models.ProgramExercise, error) {
	byProgram, err := s.loadExercisesFor([]int64{programID})
	if err != nil {
		return nil, err
	}
	return byProgram[programID], nil
}

// attachExercises batch-loads exercises + sets for a page of programs.
func (s *ProgramStore) attachExercises(programs []models.Program) error {
	ids := make([]int64, len(programs))
	for i := range programs {
		ids[i] = programs[i].ID
	}
	exByProgram, err := s.loadExercisesFor(ids)
	if err != nil {
		return err
	}
	for i := range programs {
		programs[i].Exercises = exByProgram[programs[i].ID]
	}
	return nil
}

// loadExercisesFor loads the exercises (JOIN exercises for display) and their
// sets for every given program in two queries total, instead of one per
// program plus one per exercise — every query is serialized through the
// single SQLite connection, so query count is latency. The parent cursor is
// fully scanned + closed BEFORE the sets query (#36) so a request never holds
// two pool connections at once.
func (s *ProgramStore) loadExercisesFor(programIDs []int64) (map[int64][]models.ProgramExercise, error) {
	byProgram := make(map[int64][]models.ProgramExercise, len(programIDs))
	if len(programIDs) == 0 {
		return byProgram, nil
	}
	placeholders, args := inArgs(programIDs)
	rows, err := s.db.Query(
		`SELECT pe.id, pe.program_id, pe.exercise_id, pe.order_index, pe.notes, pe.rest_seconds,
		        e.name, e.muscle_group, e.category, e.equipment, e.image_url
		 FROM program_exercises pe
		 JOIN exercises e ON e.id = pe.exercise_id
		 WHERE pe.program_id IN (`+placeholders+`) ORDER BY pe.program_id, pe.order_index`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	var exercises []models.ProgramExercise
	for rows.Next() {
		var pe models.ProgramExercise
		if err := rows.Scan(
			&pe.ID, &pe.ProgramID, &pe.ExerciseID, &pe.OrderIndex, &pe.Notes, &pe.RestSeconds,
			&pe.Exercise.Name, &pe.Exercise.MuscleGroup, &pe.Exercise.Category,
			&pe.Exercise.Equipment, &pe.Exercise.ImageURL,
		); err != nil {
			rows.Close()
			return nil, err
		}
		pe.Exercise.ID = pe.ExerciseID
		exercises = append(exercises, pe)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	setsByExercise, err := s.loadSetsFor(exercises)
	if err != nil {
		return nil, err
	}
	for _, pe := range exercises {
		pe.Sets = setsByExercise[pe.ID]
		byProgram[pe.ProgramID] = append(byProgram[pe.ProgramID], pe)
	}
	return byProgram, nil
}

// loadSetsFor fetches the sets for all given program exercises in one query,
// grouped by program_exercise_id.
func (s *ProgramStore) loadSetsFor(exercises []models.ProgramExercise) (map[int64][]models.ProgramSet, error) {
	bySet := make(map[int64][]models.ProgramSet, len(exercises))
	if len(exercises) == 0 {
		return bySet, nil
	}
	ids := make([]int64, len(exercises))
	for i := range exercises {
		ids[i] = exercises[i].ID
	}
	placeholders, args := inArgs(ids)
	rows, err := s.db.Query(
		`SELECT id, program_exercise_id, set_number, target_reps, target_weight
		 FROM program_sets WHERE program_exercise_id IN (`+placeholders+`) ORDER BY program_exercise_id, set_number`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st models.ProgramSet
		if err := rows.Scan(&st.ID, &st.ProgramExerciseID, &st.SetNumber, &st.TargetReps, &st.TargetWeight); err != nil {
			return nil, err
		}
		bySet[st.ProgramExerciseID] = append(bySet[st.ProgramExerciseID], st)
	}
	return bySet, rows.Err()
}
