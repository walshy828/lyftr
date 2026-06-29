// Package stores holds the repository layer: each entity has a store that owns
// ALL of its SQL. Controllers depend on these via *Stores (constructor-injected)
// and never touch the database directly. Stores are transport-agnostic — they
// return models + raw errors and import neither gin nor the utils HTTP helpers.
package stores

import "database/sql"

// Stores aggregates every per-entity store, constructed once from the DB handle
// and injected into the HTTP handlers.
type Stores struct {
	ActiveSession *ActiveSessionStore
	Weight        *WeightStore
	Food          *FoodStore
	User          *UserStore
	Exercise      *ExerciseStore
	Workout       *WorkoutStore
	Program       *ProgramStore
}

func New(db *sql.DB) *Stores {
	return &Stores{
		ActiveSession: NewActiveSessionStore(db),
		Weight:        NewWeightStore(db),
		Food:          NewFoodStore(db),
		User:          NewUserStore(db),
		Exercise:      NewExerciseStore(db),
		Workout:       NewWorkoutStore(db),
		Program:       NewProgramStore(db),
	}
}
