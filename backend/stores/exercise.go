package stores

import (
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/seed"
	"github.com/Cawlumm/lyftr-backend/utils"
)

// ExerciseStore owns all SQL for the (global, read-only) exercises catalog, and
// wraps the seed subsystem for the admin sync/reset endpoints.
type ExerciseStore struct{ db *sql.DB }

// ErrNotCustomExercise means the caller tried to edit/delete a library
// exercise (source != "custom") through the user-facing mutation endpoints.
var ErrNotCustomExercise = errors.New("exercise is not a custom exercise")

// ErrExerciseInUse means a delete was blocked by the exercises(id) foreign
// key still being referenced from an existing workout or program.
var ErrExerciseInUse = errors.New("exercise is referenced by an existing workout or program")

func NewExerciseStore(db *sql.DB) *ExerciseStore { return &ExerciseStore{db: db} }

// ExerciseFilter holds the optional list filters (empty string = no filter).
type ExerciseFilter struct {
	Query, MuscleGroup, Category, Equipment string
	Level, Force, Mechanic                  string
	Limit                                   int
}

// "force" is quoted throughout: it isn't reserved in SQLite, but it reads like
// a keyword and quoting costs nothing.
const exerciseSelect = `SELECT id, name, muscle_group, secondary_muscles, category, equipment, description, image_url, image_url_end, gif_url, "force", level, mechanic, source_id, source, is_timed, default_duration_seconds FROM exercises`

type scanner interface{ Scan(dest ...any) error }

func scanExercise(row scanner, e *models.Exercise) error {
	var secondaryRaw string
	if err := row.Scan(&e.ID, &e.Name, &e.MuscleGroup, &secondaryRaw, &e.Category, &e.Equipment, &e.Description,
		&e.ImageURL, &e.ImageEndURL, &e.GifURL, &e.Force, &e.Level, &e.Mechanic, &e.SourceID, &e.Source,
		&e.IsTimed, &e.DefaultDurationSeconds); err != nil {
		return err
	}
	json.Unmarshal([]byte(secondaryRaw), &e.SecondaryMuscles)
	if e.SecondaryMuscles == nil {
		e.SecondaryMuscles = []string{}
	}
	return nil
}

func (s *ExerciseStore) List(f ExerciseFilter) ([]models.Exercise, error) {
	q := exerciseSelect + ` WHERE 1=1`
	args := []any{}
	if f.Query != "" {
		q += " AND name LIKE ?"
		args = append(args, "%"+f.Query+"%")
	}
	if f.MuscleGroup != "" {
		q += " AND muscle_group = ?"
		args = append(args, f.MuscleGroup)
	}
	if f.Category != "" {
		q += " AND category = ?"
		args = append(args, f.Category)
	}
	if f.Equipment != "" {
		q += " AND equipment = ?"
		args = append(args, f.Equipment)
	}
	if f.Level != "" {
		q += " AND level = ?"
		args = append(args, f.Level)
	}
	if f.Force != "" {
		q += ` AND "force" = ?`
		args = append(args, f.Force)
	}
	if f.Mechanic != "" {
		q += " AND mechanic = ?"
		args = append(args, f.Mechanic)
	}
	q += " ORDER BY name LIMIT ?"
	args = append(args, f.Limit)

	rows, err := s.db.Query(q, args...)
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

// Get returns one exercise, or sql.ErrNoRows if not found.
func (s *ExerciseStore) Get(id int64) (models.Exercise, error) {
	var e models.Exercise
	if err := scanExercise(s.db.QueryRow(exerciseSelect+` WHERE id = ?`, id), &e); err != nil {
		return models.Exercise{}, err
	}
	return e, nil
}

// FacetValue is one filter option and how many exercises carry it.
type FacetValue struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

// Facets returns the distinct values for every filterable field, so the client
// can build filter chips without hardcoding a taxonomy that lives upstream.
//
// The counts are GLOBAL, deliberately not cross-filtered by the user's current
// selection. True faceted search means re-running this with the active
// predicate threaded through every branch on each chip tap; this is a static
// reference catalog of ~870 rows, and the client can cache the answer for the
// whole session.
func (s *ExerciseStore) Facets() (map[string][]FacetValue, error) {
	rows, err := s.db.Query(`
		SELECT 'muscle_group' AS facet, muscle_group AS value, COUNT(*) AS n FROM exercises WHERE muscle_group <> '' GROUP BY muscle_group
		UNION ALL SELECT 'equipment', equipment, COUNT(*) FROM exercises WHERE equipment <> '' GROUP BY equipment
		UNION ALL SELECT 'category',  category,  COUNT(*) FROM exercises WHERE category  <> '' GROUP BY category
		UNION ALL SELECT 'level',     level,     COUNT(*) FROM exercises WHERE level     <> '' GROUP BY level
		UNION ALL SELECT 'mechanic',  mechanic,  COUNT(*) FROM exercises WHERE mechanic  <> '' GROUP BY mechanic
		UNION ALL SELECT 'force',     "force",   COUNT(*) FROM exercises WHERE "force"   <> '' GROUP BY "force"
		ORDER BY facet ASC, n DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][]FacetValue{}
	for rows.Next() {
		var facet string
		var fv FacetValue
		if err := rows.Scan(&facet, &fv.Value, &fv.Count); err != nil {
			return nil, err
		}
		out[facet] = append(out[facet], fv)
	}
	return out, rows.Err()
}

// Create inserts a user-defined exercise, tagged source=custom so it survives
// WipeAndReseed/Sync like the lyftr cardio carve-out does (see seed.SourceCustom).
func (s *ExerciseStore) Create(name, muscleGroup, equipment, category, description, imageURL string, secondaryMuscles []string, isTimed bool, defaultDurationSeconds int) (models.Exercise, error) {
	if category == "" {
		category = "strength"
	}
	secondaryJSON, err := json.Marshal(secondaryMuscles)
	if err != nil || secondaryMuscles == nil {
		secondaryJSON = []byte("[]")
	}
	res, err := s.db.Exec(
		`INSERT INTO exercises (name, muscle_group, category, equipment, description, image_url, secondary_muscles, source, is_timed, default_duration_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		name, muscleGroup, category, equipment, description, imageURL, string(secondaryJSON), seed.SourceCustom, isTimed, defaultDurationSeconds,
	)
	if err != nil {
		return models.Exercise{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return models.Exercise{}, err
	}
	return s.Get(id)
}

// Update edits a custom exercise in place. It returns ErrNotCustomExercise if
// the row exists but isn't source=custom (library rows are never editable),
// or sql.ErrNoRows if the id doesn't exist at all.
func (s *ExerciseStore) Update(id int64, name, muscleGroup, equipment, category, description, imageURL string, secondaryMuscles []string, isTimed bool, defaultDurationSeconds int) (models.Exercise, error) {
	existing, err := s.Get(id)
	if err != nil {
		return models.Exercise{}, err
	}
	if existing.Source != seed.SourceCustom {
		return models.Exercise{}, ErrNotCustomExercise
	}
	if category == "" {
		category = "strength"
	}
	secondaryJSON, err := json.Marshal(secondaryMuscles)
	if err != nil || secondaryMuscles == nil {
		secondaryJSON = []byte("[]")
	}
	res, err := s.db.Exec(
		`UPDATE exercises SET name = ?, muscle_group = ?, category = ?, equipment = ?, description = ?, image_url = ?, secondary_muscles = ?, is_timed = ?, default_duration_seconds = ?
		 WHERE id = ? AND source = ?`,
		name, muscleGroup, category, equipment, description, imageURL, string(secondaryJSON), isTimed, defaultDurationSeconds, id, seed.SourceCustom,
	)
	if err != nil {
		return models.Exercise{}, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return models.Exercise{}, err
	} else if n == 0 {
		return models.Exercise{}, sql.ErrNoRows
	}
	return s.Get(id)
}

// Delete removes a custom exercise. It returns ErrNotCustomExercise for a
// library row, sql.ErrNoRows if the id doesn't exist, or ErrExerciseInUse if
// the exercises(id) foreign key is still referenced by a workout or program
// (SQLite enforces this at the constraint level, so there's no separate
// pre-check race to worry about).
func (s *ExerciseStore) Delete(id int64) error {
	existing, err := s.Get(id)
	if err != nil {
		return err
	}
	if existing.Source != seed.SourceCustom {
		return ErrNotCustomExercise
	}
	res, err := s.db.Exec(`DELETE FROM exercises WHERE id = ? AND source = ?`, id, seed.SourceCustom)
	if err != nil {
		if utils.IsForeignKeyViolation(err) {
			return ErrExerciseInUse
		}
		return err
	}
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *ExerciseStore) Count() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM exercises`).Scan(&n)
	return n, err
}

// Sync / SeedStatus / Reset delegate to the seed subsystem (which owns the
// ExerciseDB fetch + the concurrency guard) so the controller stays SQL-free.
func (s *ExerciseStore) Sync() error                 { return seed.SyncExercises(s.db) }
func (s *ExerciseStore) SeedStatus() seed.SeedStatus { return seed.GetSeedStatus(s.db) }
func (s *ExerciseStore) Reset() error                { return seed.WipeAndReseed(s.db) }
