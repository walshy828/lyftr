package stores

import "database/sql"

// FoodStore owns all SQL for the food entity.
type FoodStore struct{ db *sql.DB }

func NewFoodStore(db *sql.DB) *FoodStore { return &FoodStore{db: db} }
