package stores

import "database/sql"

// UserStore owns all SQL for the user entity.
type UserStore struct{ db *sql.DB }

func NewUserStore(db *sql.DB) *UserStore { return &UserStore{db: db} }
