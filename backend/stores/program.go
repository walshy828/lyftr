package stores

import "database/sql"

// ProgramStore owns all SQL for the program entity.
type ProgramStore struct{ db *sql.DB }

func NewProgramStore(db *sql.DB) *ProgramStore { return &ProgramStore{db: db} }
