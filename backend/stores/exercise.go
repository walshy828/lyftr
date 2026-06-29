package stores

import "database/sql"

// ExerciseStore owns all SQL for the exercise entity.
type ExerciseStore struct{ db *sql.DB }

func NewExerciseStore(db *sql.DB) *ExerciseStore { return &ExerciseStore{db: db} }
