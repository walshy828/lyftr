package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// ProfileStore owns all SQL for user_profile: the demographic facts used for
// BMI and AI weight-loss-plan generation.
type ProfileStore struct{ db *sql.DB }

func NewProfileStore(db *sql.DB) *ProfileStore { return &ProfileStore{db: db} }

const profileSelect = `SELECT user_id, age, sex, height_inches, activity_level FROM user_profile`

// Get returns the user's profile row, or sql.ErrNoRows if none (the
// controller owns the default fallback, mirroring GetSettings).
func (s *ProfileStore) Get(uid int64) (models.UserProfile, error) {
	var p models.UserProfile
	err := s.db.QueryRow(profileSelect+` WHERE user_id = ?`, uid).
		Scan(&p.UserID, &p.Age, &p.Sex, &p.HeightInches, &p.ActivityLevel)
	return p, err
}

// Upsert applies a partial update and returns the merged row in a single
// atomic statement, same COALESCE-over-default/existing pattern as
// UserStore.UpsertSettings.
func (s *ProfileStore) Upsert(uid int64, req models.UpsertProfileRequest) (models.UserProfile, error) {
	d := models.DefaultUserProfile(uid)
	var p models.UserProfile
	err := s.db.QueryRow(
		`INSERT INTO user_profile (user_id, age, sex, height_inches, activity_level)
		 VALUES (?, COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?))
		 ON CONFLICT(user_id) DO UPDATE SET
		   age            = COALESCE(?, user_profile.age),
		   sex            = COALESCE(?, user_profile.sex),
		   height_inches  = COALESCE(?, user_profile.height_inches),
		   activity_level = COALESCE(?, user_profile.activity_level)
		 RETURNING user_id, age, sex, height_inches, activity_level`,
		uid,
		req.Age, d.Age,
		req.Sex, d.Sex,
		req.HeightInches, d.HeightInches,
		req.ActivityLevel, d.ActivityLevel,
		req.Age, req.Sex, req.HeightInches, req.ActivityLevel,
	).Scan(&p.UserID, &p.Age, &p.Sex, &p.HeightInches, &p.ActivityLevel)
	if err != nil {
		return models.UserProfile{}, err
	}
	return p, nil
}
