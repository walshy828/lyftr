package stores

import (
	"database/sql"
	"strings"

	"github.com/Cawlumm/lyftr-backend/models"
)

// ProgramStore owns all SQL for programs, program_exercises and program_sets.
type ProgramStore struct{ db *sql.DB }

func NewProgramStore(db *sql.DB) *ProgramStore { return &ProgramStore{db: db} }

// ProgramFilter holds list paging + optional name search.
type ProgramFilter struct {
	Limit, Offset int
	Query         string
}

const programCols = `id, user_id, name, notes, is_shared, created_at`

func scanProgram(row interface{ Scan(...any) error }, p *models.Program) error {
	return row.Scan(&p.ID, &p.UserID, &p.Name, &p.Notes, &p.IsShared, &p.CreatedAt)
}

func (s *ProgramStore) List(uid int64, f ProgramFilter) ([]models.Program, error) {
	var rows *sql.Rows
	var err error
	if f.Query != "" {
		rows, err = s.db.Query(
			`SELECT `+programCols+` FROM programs WHERE user_id = ? AND LOWER(name) LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			uid, "%"+strings.ToLower(f.Query)+"%", f.Limit, f.Offset,
		)
	} else {
		rows, err = s.db.Query(
			`SELECT `+programCols+` FROM programs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			uid, f.Limit, f.Offset,
		)
	}
	if err != nil {
		return nil, err
	}
	programs := []models.Program{}
	for rows.Next() {
		var p models.Program
		if err := scanProgram(rows, &p); err != nil {
			rows.Close()
			return nil, err
		}
		programs = append(programs, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close() // close the parent cursor BEFORE loading children (#36)

	for i := range programs {
		ex, err := s.loadExercises(programs[i].ID)
		if err != nil {
			return nil, err
		}
		programs[i].Exercises = ex
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
	base := `SELECT p.id, p.user_id, p.name, p.notes, p.is_shared, p.created_at, u.email
	         FROM programs p JOIN users u ON u.id = p.user_id
	         WHERE p.is_shared = 1 AND p.user_id != ?`
	if f.Query != "" {
		rows, err = s.db.Query(base+` AND LOWER(p.name) LIKE ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
			uid, "%"+strings.ToLower(f.Query)+"%", f.Limit, f.Offset)
	} else {
		rows, err = s.db.Query(base+` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, uid, f.Limit, f.Offset)
	}
	if err != nil {
		return nil, err
	}
	programs := []models.Program{}
	for rows.Next() {
		var p models.Program
		var ownerEmail string
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Notes, &p.IsShared, &p.CreatedAt, &ownerEmail); err != nil {
			rows.Close()
			return nil, err
		}
		p.OwnerEmail = ownerEmail
		programs = append(programs, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	for i := range programs {
		ex, err := s.loadExercises(programs[i].ID)
		if err != nil {
			return nil, err
		}
		programs[i].Exercises = ex
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

// loadExercises scans + closes the parent cursor BEFORE loading each exercise's
// sets (#36), and surfaces scan errors.
func (s *ProgramStore) loadExercises(programID int64) ([]models.ProgramExercise, error) {
	rows, err := s.db.Query(
		`SELECT pe.id, pe.program_id, pe.exercise_id, pe.order_index, pe.notes, pe.rest_seconds,
		        e.name, e.muscle_group, e.category, e.equipment, e.image_url
		 FROM program_exercises pe
		 JOIN exercises e ON e.id = pe.exercise_id
		 WHERE pe.program_id = ? ORDER BY pe.order_index`,
		programID,
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

	for i := range exercises {
		sets, err := s.loadSets(exercises[i].ID)
		if err != nil {
			return nil, err
		}
		exercises[i].Sets = sets
	}
	return exercises, nil
}

func (s *ProgramStore) loadSets(programExerciseID int64) ([]models.ProgramSet, error) {
	rows, err := s.db.Query(
		`SELECT id, program_exercise_id, set_number, target_reps, target_weight
		 FROM program_sets WHERE program_exercise_id = ? ORDER BY set_number`,
		programExerciseID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var sets []models.ProgramSet
	for rows.Next() {
		var st models.ProgramSet
		if err := rows.Scan(&st.ID, &st.ProgramExerciseID, &st.SetNumber, &st.TargetReps, &st.TargetWeight); err != nil {
			return nil, err
		}
		sets = append(sets, st)
	}
	return sets, rows.Err()
}
