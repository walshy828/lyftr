package stores

import (
	"database/sql"
	"encoding/json"

	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/seed"
)

// ExerciseStore owns all SQL for the (global, read-only) exercises catalog, and
// wraps the seed subsystem for the admin sync/reset endpoints.
type ExerciseStore struct{ db *sql.DB }

func NewExerciseStore(db *sql.DB) *ExerciseStore { return &ExerciseStore{db: db} }

// ExerciseFilter holds the optional list filters (empty string = no filter).
type ExerciseFilter struct {
	Query, MuscleGroup, Category, Equipment string
	Level, Force, Mechanic                  string
	Limit                                   int
}

// "force" is quoted throughout: it isn't reserved in SQLite, but it reads like
// a keyword and quoting costs nothing.
const exerciseSelect = `SELECT id, name, muscle_group, secondary_muscles, category, equipment, description, image_url, image_url_end, "force", level, mechanic, source_id FROM exercises`

type scanner interface{ Scan(dest ...any) error }

func scanExercise(row scanner, e *models.Exercise) error {
	var secondaryRaw string
	if err := row.Scan(&e.ID, &e.Name, &e.MuscleGroup, &secondaryRaw, &e.Category, &e.Equipment, &e.Description,
		&e.ImageURL, &e.ImageEndURL, &e.Force, &e.Level, &e.Mechanic, &e.SourceID); err != nil {
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
