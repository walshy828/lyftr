package stores

import (
	"database/sql"
	"errors"

	"github.com/Cawlumm/lyftr-backend/models"
)

// ErrDefaultProfile is returned when deleting the profile that unlinked and
// removed profiles' entries fall back to.
var ErrDefaultProfile = errors.New("the default clothing profile cannot be deleted")

// ClothingStore owns all SQL for clothing_profiles: named outfits whose lbs
// offset WeightStore subtracts from raw scale readings.
type ClothingStore struct{ db *sql.DB }

func NewClothingStore(db *sql.DB) *ClothingStore { return &ClothingStore{db: db} }

// seedProfiles are a user's starting outfits. The first (offset 0) is the
// default: it's what history is back-filled to and what new entries use.
var seedProfiles = []struct {
	name   string
	offset float64
}{
	{"Summer", 0},
	{"Light layers", 2},
	{"Winter", 4},
}

// EnsureDefaults seeds the starter profiles for a user who has none, and links
// any entries not yet tied to a profile to the default. Idempotent.
func (s *ClothingStore) EnsureDefaults(uid int64) error {
	return inTxDo(s.db, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM clothing_profiles WHERE user_id = ?`, uid).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			for i, p := range seedProfiles {
				def := 0
				if i == 0 {
					def = 1
				}
				if _, err := tx.Exec(
					`INSERT INTO clothing_profiles (user_id, name, offset_lbs, is_default, sort_order) VALUES (?, ?, ?, ?, ?)`,
					uid, p.name, p.offset, def, i,
				); err != nil {
					return err
				}
			}
		}
		_, err := tx.Exec(
			`UPDATE weight_logs SET clothing_profile_id =
			   (SELECT id FROM clothing_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1)
			 WHERE user_id = ? AND clothing_profile_id IS NULL`, uid, uid)
		return err
	})
}

func (s *ClothingStore) List(uid int64) ([]models.ClothingProfile, error) {
	rows, err := s.db.Query(
		`SELECT id, name, offset_lbs, is_default, sort_order FROM clothing_profiles
		 WHERE user_id = ? ORDER BY sort_order, id`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.ClothingProfile{}
	for rows.Next() {
		var p models.ClothingProfile
		if err := rows.Scan(&p.ID, &p.Name, &p.OffsetLbs, &p.IsDefault, &p.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Get returns one user-owned profile, or sql.ErrNoRows.
func (s *ClothingStore) Get(uid, id int64) (models.ClothingProfile, error) {
	var p models.ClothingProfile
	err := s.db.QueryRow(
		`SELECT id, name, offset_lbs, is_default, sort_order FROM clothing_profiles WHERE id = ? AND user_id = ?`,
		id, uid).Scan(&p.ID, &p.Name, &p.OffsetLbs, &p.IsDefault, &p.SortOrder)
	return p, err
}

func (s *ClothingStore) Create(uid int64, req models.ClothingProfileRequest) (models.ClothingProfile, error) {
	res, err := s.db.Exec(
		`INSERT INTO clothing_profiles (user_id, name, offset_lbs, sort_order)
		 VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM clothing_profiles WHERE user_id = ?))`,
		uid, req.Name, req.OffsetLbs, uid)
	if err != nil {
		return models.ClothingProfile{}, err
	}
	id, _ := res.LastInsertId()
	return s.Get(uid, id)
}

// Update edits a user-owned profile (sql.ErrNoRows if not theirs). Entries
// using it re-adjust automatically since the offset is applied at read time.
func (s *ClothingStore) Update(uid, id int64, req models.ClothingProfileRequest) (models.ClothingProfile, error) {
	res, err := s.db.Exec(
		`UPDATE clothing_profiles SET name = ?, offset_lbs = ? WHERE id = ? AND user_id = ?`,
		req.Name, req.OffsetLbs, id, uid)
	if err != nil {
		return models.ClothingProfile{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return models.ClothingProfile{}, sql.ErrNoRows
	}
	return s.Get(uid, id)
}

// Delete removes a non-default profile, moving its entries to the default so
// their adjusted weights don't silently change meaning.
func (s *ClothingStore) Delete(uid, id int64) error {
	return inTxDo(s.db, func(tx *sql.Tx) error {
		var isDefault bool
		if err := tx.QueryRow(
			`SELECT is_default FROM clothing_profiles WHERE id = ? AND user_id = ?`, id, uid,
		).Scan(&isDefault); err != nil {
			return err
		}
		if isDefault {
			return ErrDefaultProfile
		}
		if _, err := tx.Exec(
			`UPDATE weight_logs SET clothing_profile_id =
			   (SELECT id FROM clothing_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1)
			 WHERE user_id = ? AND clothing_profile_id = ?`, uid, uid, id); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM clothing_profiles WHERE id = ? AND user_id = ?`, id, uid)
		return err
	})
}
