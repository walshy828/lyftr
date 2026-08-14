package stores

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/seed"
)

// ExerciseMigrationStore owns the SQL for the AI-assisted exercise-library
// migration flow (switching config.ExerciseLibrarySource without losing
// existing workout/program history) — see controllers/exercise_migration.go
// for the preview/confirm sequencing this supports.
type ExerciseMigrationStore struct{ db *sql.DB }

func NewExerciseMigrationStore(db *sql.DB) *ExerciseMigrationStore {
	return &ExerciseMigrationStore{db: db}
}

// MigrationMappingEntry is one proposed (or manually resolved) old->new
// exercise mapping. NewExerciseID is 0 until Confirm resolves MatchedName
// against the newly-seeded target library — it doesn't exist at proposal
// time. LeaveUnmigrated marks an entry the admin explicitly chose to skip:
// its old exercise row survives the prune indefinitely.
type MigrationMappingEntry struct {
	OldExerciseID   int64  `json:"old_exercise_id"`
	OldName         string `json:"old_name"`
	MatchedName     string `json:"matched_name,omitempty"`
	NewExerciseID   int64  `json:"new_exercise_id,omitempty"`
	Confidence      string `json:"confidence"`
	Reasoning       string `json:"reasoning,omitempty"`
	LeaveUnmigrated bool   `json:"leave_unmigrated"`
}

// ExerciseMigration is one row of the exercise_migrations audit table.
type ExerciseMigration struct {
	ID          int64                   `json:"id"`
	FromSource  string                  `json:"from_source"`
	ToSource    string                  `json:"to_source"`
	Status      string                  `json:"status"`
	Mapping     []MigrationMappingEntry `json:"mapping"`
	AppliedBy   string                  `json:"applied_by,omitempty"`
	Error       string                  `json:"error,omitempty"`
	StartedAt   time.Time               `json:"started_at"`
	CompletedAt *time.Time              `json:"completed_at,omitempty"`
}

const migrationSelect = `SELECT id, from_source, to_source, status, mapping_json, applied_by, error, started_at, completed_at FROM exercise_migrations`

func scanMigration(row scanner) (ExerciseMigration, error) {
	var m ExerciseMigration
	var mappingRaw string
	var completedAt sql.NullTime
	if err := row.Scan(&m.ID, &m.FromSource, &m.ToSource, &m.Status, &mappingRaw, &m.AppliedBy, &m.Error, &m.StartedAt, &completedAt); err != nil {
		return ExerciseMigration{}, err
	}
	if completedAt.Valid {
		m.CompletedAt = &completedAt.Time
	}
	if err := json.Unmarshal([]byte(mappingRaw), &m.Mapping); err != nil {
		return ExerciseMigration{}, fmt.Errorf("decode mapping_json: %w", err)
	}
	if m.Mapping == nil {
		m.Mapping = []MigrationMappingEntry{}
	}
	return m, nil
}

// InUseExercises returns the exercises actually referenced by a saved workout
// or program, restricted to one library (source). This — not the full ~870-
// 1300 row catalog — is what actually needs an AI match: an exercise nobody
// has ever logged has no history to preserve.
func (s *ExerciseMigrationStore) InUseExercises(source string) ([]models.Exercise, error) {
	rows, err := s.db.Query(exerciseSelect+`
		WHERE source = ?
		  AND (id IN (SELECT exercise_id FROM workout_exercises)
		    OR id IN (SELECT exercise_id FROM program_exercises))
		ORDER BY name`, source)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	exercises := []models.Exercise{}
	for rows.Next() {
		var e models.Exercise
		if err := scanExercise(rows, &e); err != nil {
			return nil, err
		}
		exercises = append(exercises, e)
	}
	return exercises, rows.Err()
}

// LatestMigration returns the most recent migration record, or
// (ExerciseMigration{}, sql.ErrNoRows) if none exists yet.
func (s *ExerciseMigrationStore) LatestMigration() (ExerciseMigration, error) {
	return scanMigration(s.db.QueryRow(migrationSelect + ` ORDER BY id DESC LIMIT 1`))
}

// SaveProposal records a fresh preview. Re-running preview supersedes the
// previous proposal rather than appending — each call is a new row, and the
// controller decides (via LatestMigration) whether an unresolved proposal
// already exists before calling this.
func (s *ExerciseMigrationStore) SaveProposal(fromSource, toSource string, mapping []MigrationMappingEntry) (int64, error) {
	mappingJSON, err := json.Marshal(mapping)
	if err != nil {
		return 0, err
	}
	res, err := s.db.Exec(`INSERT INTO exercise_migrations (from_source, to_source, status, mapping_json) VALUES (?, ?, 'proposed', ?)`,
		fromSource, toSource, string(mappingJSON))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// MarkApplied finalizes a migration record with the mapping actually applied
// (which may differ from the original proposal — manually resolved rows) and
// who confirmed it.
func (s *ExerciseMigrationStore) MarkApplied(id int64, appliedBy string, mapping []MigrationMappingEntry) error {
	mappingJSON, err := json.Marshal(mapping)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE exercise_migrations
		SET status = 'applied', mapping_json = ?, applied_by = ?, completed_at = CURRENT_TIMESTAMP
		WHERE id = ?`, string(mappingJSON), appliedBy, id)
	return err
}

// MarkFailed records why a confirm attempt didn't complete, leaving the
// record inspectable and the id retryable (SeedAndRepoint's steps are each
// individually idempotent — see the controller for the retry rationale).
func (s *ExerciseMigrationStore) MarkFailed(id int64, errMsg string) error {
	_, err := s.db.Exec(`UPDATE exercise_migrations SET status = 'failed', error = ? WHERE id = ?`, errMsg, id)
	return err
}

// GetMigration returns one record by id, or sql.ErrNoRows if not found.
func (s *ExerciseMigrationStore) GetMigration(id int64) (ExerciseMigration, error) {
	return scanMigration(s.db.QueryRow(migrationSelect+` WHERE id = ?`, id))
}

// RepointAndPrune is the irreversible commit step: for every old->new pair in
// mapping, repoint every workout_exercises/program_exercises row that
// referenced the old exercise onto the new one, then delete whatever's left
// unreferenced in fromSource. All in one transaction — if the prune's guard
// ever finds a from-source row that's still referenced (a caller bug: an
// in-use exercise missing from mapping), the whole repoint rolls back rather
// than leaving history half-migrated.
//
// The prune is scoped to fromSource so it can never touch the newly-seeded
// target library's rows or the "lyftr" cardio carve-out, mirroring
// seed.WipeAndReseed's own guard.
func (s *ExerciseMigrationStore) RepointAndPrune(mapping map[int64]int64, fromSource string) error {
	return inTxDo(s.db, func(tx *sql.Tx) error {
		for oldID, newID := range mapping {
			if _, err := tx.Exec(`UPDATE workout_exercises SET exercise_id = ? WHERE exercise_id = ?`, newID, oldID); err != nil {
				return fmt.Errorf("repoint workout_exercises for exercise %d: %w", oldID, err)
			}
			if _, err := tx.Exec(`UPDATE program_exercises SET exercise_id = ? WHERE exercise_id = ?`, newID, oldID); err != nil {
				return fmt.Errorf("repoint program_exercises for exercise %d: %w", oldID, err)
			}
		}
		if _, err := tx.Exec(`DELETE FROM exercises
			WHERE source = ?
			  AND id NOT IN (SELECT exercise_id FROM workout_exercises)
			  AND id NOT IN (SELECT exercise_id FROM program_exercises)`, fromSource); err != nil {
			return fmt.Errorf("prune %s library: %w", fromSource, err)
		}
		return nil
	})
}

// SyncTargetLibrary seeds `source` alongside whatever library is currently
// active, without touching or pruning it — see seed.SyncInto.
func (s *ExerciseMigrationStore) SyncTargetLibrary(source string) error {
	return seed.SyncInto(s.db, source)
}

// ExerciseIDByName looks up a newly-seeded exercise's id by (name, source) —
// used to resolve the AI proposal's name-keyed matches once the target
// library has actually been persisted (see controller Confirm step).
func (s *ExerciseMigrationStore) ExerciseIDByName(name, source string) (int64, error) {
	var id int64
	err := s.db.QueryRow(`SELECT id FROM exercises WHERE name = ? AND source = ?`, name, source).Scan(&id)
	return id, err
}
