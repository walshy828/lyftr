package stores

import "database/sql"

// WorkoutStore owns all SQL for the workout entity.
type WorkoutStore struct{ db *sql.DB }

func NewWorkoutStore(db *sql.DB) *WorkoutStore { return &WorkoutStore{db: db} }
