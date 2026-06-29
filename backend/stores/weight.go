package stores

import "database/sql"

// WeightStore owns all SQL for the weight entity.
type WeightStore struct{ db *sql.DB }

func NewWeightStore(db *sql.DB) *WeightStore { return &WeightStore{db: db} }
