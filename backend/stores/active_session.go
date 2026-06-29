package stores

import "database/sql"

// ActiveSessionStore owns all SQL for the active_session entity.
type ActiveSessionStore struct{ db *sql.DB }

func NewActiveSessionStore(db *sql.DB) *ActiveSessionStore { return &ActiveSessionStore{db: db} }
