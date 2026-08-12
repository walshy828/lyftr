package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// UserStore owns all SQL for users and user_settings.
type UserStore struct{ db *sql.DB }

func NewUserStore(db *sql.DB) *UserStore { return &UserStore{db: db} }

func (s *UserStore) GetMe(uid int64) (models.User, error) {
	var u models.User
	err := s.db.QueryRow(`SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?`, uid).
		Scan(&u.ID, &u.Email, &u.Name, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

// GetByEmail loads a user incl. password_hash for login. sql.ErrNoRows if absent.
func (s *UserStore) GetByEmail(email string) (models.User, error) {
	var u models.User
	err := s.db.QueryRow(
		`SELECT id, email, name, password_hash, token_version, created_at, updated_at FROM users WHERE email = ?`, email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.Password, &u.TokenVersion, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

// TokenVersion returns the user's current revocation epoch. Auth compares this
// against the tv claim on every JWT request, so it is the hot path.
func (s *UserStore) TokenVersion(uid int64) (int64, error) {
	var v int64
	err := s.db.QueryRow(`SELECT token_version FROM users WHERE id = ?`, uid).Scan(&v)
	return v, err
}

// BumpTokenVersion invalidates every token the user currently holds. Used on
// password change and account deletion — the cases where "sign me out
// everywhere" is the whole point.
func (s *UserStore) BumpTokenVersion(uid int64) (int64, error) {
	var v int64
	err := s.db.QueryRow(
		`UPDATE users SET token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ? RETURNING token_version`, uid,
	).Scan(&v)
	return v, err
}

// UpdatePassword sets a new hash and bumps token_version in one transaction, so
// there is no window where the old password is dead but its sessions still work.
// Returns the new token_version for minting the caller's replacement pair.
func (s *UserStore) UpdatePassword(uid int64, hash string) (int64, error) {
	return inTx(s.db, func(tx *sql.Tx) (int64, error) {
		if _, err := tx.Exec(
			`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, hash, uid,
		); err != nil {
			return 0, err
		}
		var v int64
		if err := tx.QueryRow(
			`UPDATE users SET token_version = token_version + 1 WHERE id = ? RETURNING token_version`, uid,
		).Scan(&v); err != nil {
			return 0, err
		}
		return v, nil
	})
}

// GetPasswordHash loads just the stored hash, for confirming the current
// password before a change.
func (s *UserStore) GetPasswordHash(uid int64) (string, error) {
	var h string
	err := s.db.QueryRow(`SELECT password_hash FROM users WHERE id = ?`, uid).Scan(&h)
	return h, err
}

// UpdateName sets the user's display name and returns the refreshed row.
func (s *UserStore) UpdateName(uid int64, name string) (models.User, error) {
	_, err := s.db.Exec(`UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, name, uid)
	if err != nil {
		return models.User{}, err
	}
	return s.GetMe(uid)
}

const userSettingsSelect = `SELECT user_id, weight_unit, calorie_target, protein_target, carb_target, fat_target, cholesterol_target, sodium_target, food_allergies, food_dislikes, food_likes, plan_history_start, ai_health_insights_opt_in, session_max_days FROM user_settings`

// GetSettings returns the user's settings row, or sql.ErrNoRows if none (the
// controller owns the default fallback).
func (s *UserStore) GetSettings(uid int64) (models.UserSettings, error) {
	var st models.UserSettings
	err := s.db.QueryRow(userSettingsSelect+` WHERE user_id = ?`, uid).
		Scan(&st.UserID, &st.WeightUnit, &st.CalorieTarget, &st.ProteinTarget, &st.CarbTarget, &st.FatTarget,
			&st.CholesterolTarget, &st.SodiumTarget, &st.FoodAllergies, &st.FoodDislikes, &st.FoodLikes, &st.PlanHistoryStart,
			&st.AIHealthInsightsOptIn, &st.SessionMaxDays)
	return st, err
}

// UpsertSettings applies a partial update and returns the merged row in a single
// atomic statement. For each field the nullable request value is COALESCEd over
// the default (on insert) or over the existing row (on conflict), so a partial PUT
// (e.g. weight-unit only) can never zero the fields it omitted (#37). Doing it in
// one INSERT…ON CONFLICT…RETURNING avoids a read-modify-write window where two
// concurrent partial updates could lose one another's change, and returns the
// stored row without a second SELECT. A nil pointer binds as SQL NULL; a non-nil
// pointer (incl. an explicit 0) binds as its value, so intentional zeros survive.
func (s *UserStore) UpsertSettings(uid int64, req models.UpdateSettingsRequest) (models.UserSettings, error) {
	d := models.DefaultUserSettings(uid)
	var st models.UserSettings
	err := s.db.QueryRow(
		`INSERT INTO user_settings (user_id, weight_unit, calorie_target, protein_target, carb_target, fat_target, cholesterol_target, sodium_target, food_allergies, food_dislikes, food_likes, plan_history_start, ai_health_insights_opt_in, session_max_days)
		 VALUES (?, COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?), COALESCE(?, ?))
		 ON CONFLICT(user_id) DO UPDATE SET
		   weight_unit        = COALESCE(?, user_settings.weight_unit),
		   calorie_target     = COALESCE(?, user_settings.calorie_target),
		   protein_target     = COALESCE(?, user_settings.protein_target),
		   carb_target        = COALESCE(?, user_settings.carb_target),
		   fat_target         = COALESCE(?, user_settings.fat_target),
		   cholesterol_target = COALESCE(?, user_settings.cholesterol_target),
		   sodium_target      = COALESCE(?, user_settings.sodium_target),
		   food_allergies     = COALESCE(?, user_settings.food_allergies),
		   food_dislikes      = COALESCE(?, user_settings.food_dislikes),
		   food_likes         = COALESCE(?, user_settings.food_likes),
		   plan_history_start = COALESCE(?, user_settings.plan_history_start),
		   ai_health_insights_opt_in = COALESCE(?, user_settings.ai_health_insights_opt_in),
		   session_max_days   = COALESCE(?, user_settings.session_max_days)
		 RETURNING user_id, weight_unit, calorie_target, protein_target, carb_target, fat_target, cholesterol_target, sodium_target, food_allergies, food_dislikes, food_likes, plan_history_start, ai_health_insights_opt_in, session_max_days`,
		uid,
		req.WeightUnit, d.WeightUnit,
		req.CalorieTarget, d.CalorieTarget,
		req.ProteinTarget, d.ProteinTarget,
		req.CarbTarget, d.CarbTarget,
		req.FatTarget, d.FatTarget,
		req.CholesterolTarget, d.CholesterolTarget,
		req.SodiumTarget, d.SodiumTarget,
		req.FoodAllergies, d.FoodAllergies,
		req.FoodDislikes, d.FoodDislikes,
		req.FoodLikes, d.FoodLikes,
		req.PlanHistoryStart, d.PlanHistoryStart,
		req.AIHealthInsightsOptIn, d.AIHealthInsightsOptIn,
		req.SessionMaxDays, d.SessionMaxDays,
		req.WeightUnit, req.CalorieTarget, req.ProteinTarget, req.CarbTarget, req.FatTarget,
		req.CholesterolTarget, req.SodiumTarget,
		req.FoodAllergies, req.FoodDislikes, req.FoodLikes,
		req.PlanHistoryStart, req.AIHealthInsightsOptIn, req.SessionMaxDays,
	).Scan(&st.UserID, &st.WeightUnit, &st.CalorieTarget, &st.ProteinTarget, &st.CarbTarget, &st.FatTarget,
		&st.CholesterolTarget, &st.SodiumTarget, &st.FoodAllergies, &st.FoodDislikes, &st.FoodLikes, &st.PlanHistoryStart,
		&st.AIHealthInsightsOptIn, &st.SessionMaxDays)
	if err != nil {
		return models.UserSettings{}, err
	}
	return st, nil
}

// Create inserts a user and their default settings atomically (one transaction —
// fixes the previous non-transactional gap). A duplicate email surfaces as a
// UNIQUE violation for the controller to map to 409.
func (s *UserStore) Create(email, hash string) (int64, error) {
	return inTx(s.db, func(tx *sql.Tx) (int64, error) {
		res, err := tx.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, email, hash)
		if err != nil {
			return 0, err
		}
		uid, _ := res.LastInsertId()
		if _, err := tx.Exec(`INSERT INTO user_settings (user_id) VALUES (?)`, uid); err != nil {
			return 0, err
		}
		return uid, nil
	})
}

// IsEmpty reports whether the instance has no accounts yet. Register uses this
// to let a fresh install create its first user even when registration is
// otherwise closed — without it, the closed-by-default setting would lock a new
// deployment out of itself.
func (s *UserStore) IsEmpty() (bool, error) {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return false, err
	}
	return n == 0, nil
}

// Delete removes the user; child rows go via ON DELETE CASCADE (foreign_keys=on).
func (s *UserStore) Delete(uid int64) error {
	_, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, uid)
	return err
}
